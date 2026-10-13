"""Compare generated notes with a reference: mir_eval frame and note metrics, after
removing the global time offset (references often carry a different GAP)."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from .export import from_site_melody, notes_to_curve, parse_ultrastar
from .notes import Note, hz_from_midi

HOP = 0.01


def load_any(path: Path) -> list[Note]:
    """An output dir (its melody.json), a site melody.json, or an UltraStar .txt."""
    p = Path(path)
    if p.is_dir():
        p = p / "melody.json"
    if p.suffix == ".txt":
        return parse_ultrastar(p.read_text(encoding="utf-8", errors="replace"))[0]
    return from_site_melody(json.loads(p.read_text()))


def estimate_offset(ref: np.ndarray, est: np.ndarray, max_lag_sec: float) -> float:
    """Seconds to ADD to est times so its voiced mask best overlaps ref's."""
    from scipy.signal import correlate

    a = (~np.isnan(ref)).astype(float) - 0.5
    b = (~np.isnan(est)).astype(float) - 0.5
    n = max(len(a), len(b))
    a, b = np.pad(a, (0, n - len(a))), np.pad(b, (0, n - len(b)))
    c = correlate(a, b, mode="full", method="fft")
    lags = np.arange(-n + 1, n)
    keep = np.abs(lags) <= int(max_lag_sec / HOP)
    return float(lags[keep][np.argmax(c[keep])] * HOP)


def _shift(notes: list[Note], dt: float) -> list[Note]:
    return [Note(n.start + dt, n.end + dt, n.midi, n.syllable, n.line_break, list(n.flags)) for n in notes]


def _intervals(notes: list[Note]) -> tuple[np.ndarray, np.ndarray]:
    if not notes:
        return np.zeros((0, 2)), np.zeros(0)
    return (np.array([[n.start, max(n.end, n.start + 1e-3)] for n in notes]),
            np.array([hz_from_midi(n.midi) for n in notes]))


def worst_regions(ref: np.ndarray, est: np.ndarray, k: int = 10, win_sec: float = 2.0) -> list[dict]:
    """Non-overlapping 2 s windows with the most wrong frames, and what kind of wrong."""
    rv, ev = ~np.isnan(ref), ~np.isnan(est)
    both = rv & ev
    diff = np.where(both, np.abs(np.nan_to_num(est) - np.nan_to_num(ref)), 0)
    chroma = np.abs(diff - 12 * np.round(diff / 12))
    kinds = {
        "missed voicing": rv & ~ev,
        "false alarm": ~rv & ev,
        "octave error": both & (diff >= 0.5) & (chroma < 0.5),
        "wrong pitch": both & (chroma >= 0.5),
    }
    err = sum(v.astype(int) for v in kinds.values())
    w, step = int(win_sec / HOP), int(win_sec / HOP / 2)
    scored = sorted(((int(err[s : s + w].sum()), s) for s in range(0, max(1, len(err) - w + 1), step)), reverse=True)
    out, taken = [], []
    for e, s in scored:
        if e == 0 or len(out) == k:
            break
        if any(abs(s - t) < w for t in taken):
            continue
        taken.append(s)
        seg = {kk: int(v[s : s + w].sum()) for kk, v in kinds.items()}
        out.append({"start": round(s * HOP, 2), "end": round((s + w) * HOP, 2), "error_frames": e,
                    "main": max(seg, key=seg.get), "by_type": seg})
    return out


def evaluate_pair(pred: Path, ref: Path, max_lag_sec: float = 10.0) -> dict:
    return {"pred": str(pred), "ref": str(ref), **evaluate_notes(load_any(pred), load_any(ref), max_lag_sec)}


def evaluate_notes(est_notes: list[Note], ref_notes: list[Note], max_lag_sec: float = 10.0) -> dict:
    import mir_eval

    length = max([n.end for n in ref_notes + est_notes] + [1.0]) + max_lag_sec + 1
    ref_c = notes_to_curve(ref_notes, HOP, length)
    offset = estimate_offset(ref_c, notes_to_curve(est_notes, HOP, length), max_lag_sec)
    est_notes = _shift(est_notes, offset)
    est_c = notes_to_curve(est_notes, HOP, length)

    t = np.arange(len(ref_c)) * HOP
    def to_hz(c):
        return np.where(np.isnan(c), 0.0, 440 * 2 ** ((np.nan_to_num(c) - 69) / 12))
    mel = mir_eval.melody.evaluate(t, to_hz(ref_c), t, to_hz(est_c))
    ri, rp = _intervals(ref_notes)
    ei, ep = _intervals(est_notes)
    _, _, note_f, _ = mir_eval.transcription.precision_recall_f1_overlap(
        ri, rp, ei, ep, onset_tolerance=0.05, pitch_tolerance=50.0, offset_ratio=None)
    _, _, onset_f = mir_eval.transcription.onset_precision_recall_f1(ri, ei, onset_tolerance=0.05)
    return {
        "offset_sec": round(offset, 2),
        "raw_pitch": mel["Raw Pitch Accuracy"], "raw_chroma": mel["Raw Chroma Accuracy"],
        "overall": mel["Overall Accuracy"], "voicing_recall": mel["Voicing Recall"],
        "voicing_false_alarm": mel["Voicing False Alarm"],
        "onset_f": onset_f, "note_f": note_f,
        "ref_notes": len(ref_notes), "pred_notes": len(est_notes),
        "worst": worst_regions(ref_c, est_c),
    }


COLS = [("offset_sec", "offset s"), ("raw_pitch", "RPA"), ("raw_chroma", "RCA"), ("overall", "OA"),
        ("voicing_recall", "V rec"), ("voicing_false_alarm", "V FA"), ("onset_f", "onset F"),
        ("note_f", "note F"), ("pred_notes", "notes"), ("ref_notes", "ref notes")]


def table(rows: list[dict], names: list[str]) -> str:
    lines = ["| song | " + " | ".join(c for _, c in COLS) + " |", "|" + "---|" * (len(COLS) + 1)]
    for name, r in zip(names, rows):
        cells = [f"{r[k]:.3f}" if isinstance(r[k], float) and k != "offset_sec" else str(r[k]) for k, _ in COLS]
        lines.append(f"| {name} | " + " | ".join(cells) + " |")
    if len(rows) > 1:
        mean = [f"{np.mean([r[k] for r in rows]):.3f}" if k not in ("offset_sec", "pred_notes", "ref_notes") else ""
                for k, _ in COLS]
        lines.append("| **mean** | " + " | ".join(mean) + " |")
    return "\n".join(lines)


def worst_text(rows: list[dict], names: list[str]) -> str:
    out = []
    for name, r in zip(names, rows):
        out.append(f"\n{name}: worst regions (ref timeline)")
        for w in r["worst"]:
            out.append(f"  {w['start']:7.2f}-{w['end']:7.2f}s  {w['error_frames']:4d} bad frames  mostly {w['main']}")
    return "\n".join(out)
