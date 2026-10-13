"""Stage 4: continuous MIDI curve -> discrete notes.

Frame i of the curve stands for time i * hop. A note spanning frames [a, b)
covers [a * hop, b * hop).
"""

from __future__ import annotations

import numpy as np

from .notes import Note


def _frames(sec: float, hop: float) -> int:
    return max(1, int(round(sec / hop)))


def median_smooth(m: np.ndarray, k: int) -> np.ndarray:
    """Median over a k-frame window, ignoring NaN (unvoiced). Unvoiced frames stay NaN."""
    if k <= 1:
        return m.copy()
    half = k // 2
    pad = np.pad(m, half, constant_values=np.nan)
    win = np.lib.stride_tricks.sliding_window_view(pad, k)
    out = np.full_like(m, np.nan)
    ok = ~np.isnan(m)
    if ok.any():
        out[ok] = np.nanmedian(win[ok], axis=1)
    return out


def voiced_runs(voiced: np.ndarray, max_gap: int) -> list[tuple[int, int]]:
    """[a, b) runs of voiced frames, bridging unvoiced gaps of at most max_gap frames."""
    idx = np.flatnonzero(voiced)
    if idx.size == 0:
        return []
    runs = []
    a = prev = idx[0]
    for i in idx[1:]:
        if i - prev - 1 > max_gap:
            runs.append((a, prev + 1))
            a = i
        prev = i
    runs.append((a, prev + 1))
    return runs


def find_glides(m: np.ndarray, a: int, b: int, hop: float, cfg: dict) -> list[tuple[int, int]]:
    """Stretches inside [a, b) where the pitch keeps sliding one way fast enough, for long enough."""
    k = 5  # slope window (frames)
    if b - a < k:
        return []
    t = np.arange(k) * hop
    t -= t.mean()
    slope = np.zeros(b - a)
    seg = m[a:b]
    for i in range(b - a - k + 1):
        w = seg[i : i + k]
        if np.isnan(w).any():
            continue
        slope[i + k // 2] = float((t * (w - w.mean())).sum() / (t * t).sum())
    rate = cfg["glide_rate_st_per_sec"]
    sign = np.where(slope >= rate, 1, np.where(slope <= -rate, -1, 0))
    out = []
    i = 0
    while i < len(sign):
        if sign[i] == 0:
            i += 1
            continue
        j = i
        while j < len(sign) and sign[j] == sign[i]:
            j += 1
        ga, gb = a + i, a + j
        span = abs(seg[j - 1] - seg[i]) if not np.isnan(seg[[i, j - 1]]).any() else 0
        if (gb - ga) * hop >= cfg["glide_min_sec"] and span >= cfg["glide_min_span_st"]:
            out.append((ga, gb))
        i = j
    return out


def moving_mean(m: np.ndarray, k: int) -> np.ndarray:
    """Centred k-frame mean over voiced frames only. Unvoiced frames stay NaN."""
    ok = ~np.isnan(m)
    ker = np.ones(k)
    num = np.convolve(np.where(ok, m, 0.0), ker, "same")
    den = np.convolve(ok.astype(float), ker, "same")
    return np.where(ok, num / np.maximum(den, 1), np.nan)


def _steady_notes(m: np.ndarray, s: np.ndarray, a: int, b: int, hop: float, cfg: dict) -> list[Note]:
    """Hold-rule segmentation: split when the pitch leaves the note centre and stays away.

    Decisions read `s`, the curve averaged over about one vibrato cycle, so
    vibrato cannot fake a note change. The boundary and the note's pitch come
    from `m`, the lightly smoothed curve, so they stay sharp.
    """
    split, hold = cfg["split_st"], cfg["split_hold_sec"]
    half_w = _frames(cfg["vibrato_sec"], hop) // 2
    notes: list[Note] = []
    cur: list[int] = []  # frames of the current note
    cand: int | None = None  # first frame that left the centre (same side since)
    side = 0.0

    def emit(frames: list[int]):
        if frames:
            pitch = int(round(float(np.median(m[frames]))))
            notes.append(Note(frames[0] * hop, (frames[-1] + 1) * hop, pitch))

    for i in range(a, b):
        if np.isnan(m[i]):
            continue
        if not cur:
            cur = [i]
            continue
        settled = [j for j in cur if cand is None or j < cand] or cur
        center = float(np.median(s[settled]))
        d = s[i] - center
        cur.append(i)
        if abs(d) <= split:
            cand = None
            continue
        if cand is None or np.sign(d) != side:
            cand, side = i, float(np.sign(d))
        if (i - cand + 1) * hop < hold:
            continue
        # A real change. Put the boundary where the sharp curve first sits nearer
        # the new pitch than the old one, searching back about half a vibrato window.
        new_c = float(np.median(m[[j for j in cur if j >= cand]]))
        cut = next((j for j in cur if j >= cand - half_w and abs(m[j] - new_c) < abs(m[j] - center)), cand)
        emit([j for j in cur if j < cut])
        cur = [j for j in cur if j >= cut]
        cand = None
    emit(cur)
    return notes


def _glide_notes(m: np.ndarray, a: int, b: int, hop: float, cfg: dict) -> list[Note]:
    """A slide becomes the semitones it passes through, each a short flagged note."""
    min_frames = _frames(cfg["glide_min_note_sec"], hop)
    runs: list[list[int]] = []  # [start, end, midi]
    for i in range(a, b):
        if np.isnan(m[i]):
            continue
        q = int(round(m[i]))
        if runs and runs[-1][2] == q and runs[-1][1] == i:
            runs[-1][1] = i + 1
        else:
            runs.append([i, i + 1, q])
    merged: list[list[int]] = []
    for r in runs:
        if merged and r[1] - r[0] < min_frames:
            merged[-1][1] = r[1]  # too short to stand alone: fold into the previous step
        else:
            merged.append(r)
    return [Note(s * hop, e * hop, q, flags=["glide"]) for s, e, q in merged]


def split_at_dips(notes: list[Note], energy: np.ndarray, hop: float, cfg: dict) -> list[Note]:
    """Split steady notes where loudness dips by onset_dip_db and recovers within
    onset_dip_window_sec on both sides: a consonant re-articulating the same pitch.
    The second half is flagged so the same-pitch merge leaves it alone."""
    dip, w = cfg["onset_dip_db"], _frames(cfg["onset_dip_window_sec"], hop)
    min_len = _frames(cfg["min_note_sec"], hop)
    out: list[Note] = []
    for n in notes:
        if "glide" in n.flags:
            out.append(n)
            continue
        a, b = int(round(n.start / hop)), int(round(n.end / hop))
        cuts = []
        i = a + min_len
        while i < b - min_len:
            e = energy[i]
            if (e <= energy[max(a, i - 2): i + 3].min()
                    and energy[max(a, i - w): i].max() - e >= dip
                    and energy[i + 1: min(b, i + 1 + w)].max() - e >= dip):
                cuts.append(i)
                i += min_len
            else:
                i += 1
        edges = [a] + cuts + [b]
        for k, (s, t) in enumerate(zip(edges, edges[1:])):
            flags = n.flags + (["rearticulated"] if k else [])
            out.append(Note(s * hop, t * hop, n.midi, n.syllable, n.line_break if k == 0 else False, flags))
    return out


def postprocess(notes: list[Note], cfg: dict) -> list[Note]:
    notes = sorted(notes, key=lambda n: n.start)
    notes = [n for n in notes if n.dur >= cfg["min_note_sec"] - 1e-9 or "glide" in n.flags]
    out: list[Note] = []
    for n in notes:
        p = out[-1] if out else None
        if p and p.midi == n.midi and n.start - p.end < cfg["merge_gap_sec"] and "rearticulated" not in n.flags:
            p.end = max(p.end, n.end)
            p.flags = sorted(set(p.flags) | set(n.flags))
        else:
            out.append(n)
    return out


def segment(midi: np.ndarray, voiced: np.ndarray, hop: float, cfg: dict,
            energy_db: np.ndarray | None = None) -> list[Note]:
    """cfg is the `segmentation` section of config.yaml. energy_db (same grid as
    midi) enables splitting repeated same-pitch notes at consonant dips."""
    m = np.where(voiced, midi, np.nan).astype(float)
    m = median_smooth(m, _frames(cfg["median_sec"], hop) | 1)
    s = moving_mean(m, _frames(cfg["vibrato_sec"], hop) | 1)
    notes: list[Note] = []
    for a, b in voiced_runs(~np.isnan(m), _frames(cfg["gap_break_sec"], hop)):
        pos = a
        for ga, gb in find_glides(m, a, b, hop, cfg):
            notes += _steady_notes(m, s, pos, ga, hop, cfg)
            notes += _glide_notes(m, ga, gb, hop, cfg)
            pos = gb
        notes += _steady_notes(m, s, pos, b, hop, cfg)
    if energy_db is not None and cfg.get("onset_dip_db"):
        notes = split_at_dips(notes, energy_db, hop, cfg)
    return postprocess(notes, cfg)
