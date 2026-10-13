"""Synthetic benchmark: known notes -> sung-vowel audio -> stages 2-4 -> mir_eval.

There are no hand-made reference note files for the site's songs, so this is
the only place with true answers. It renders melodies for four voice ranges
with vibrato, scoops into notes, slides, consonant gaps and breath noise, runs
the real tracker (RMVPE by default), octave repair, tuning and segmentation,
and scores the notes against what was rendered. It is not a substitute for real
references: synthetic vowels are easier than a real singer.

    ./ne benchmark            score the current config
    ./ne benchmark --sweep    vary each segmentation threshold, report mean and worst voice
"""

from __future__ import annotations

import copy
import tempfile
from pathlib import Path

import numpy as np

from . import pitch, segment, tuning
from .evaluate import evaluate_notes
from .notes import Note

SR = 16000
# name, lowest MIDI, highest MIDI, vibrato depth (+- semitones), seed
VOICES = [("bass", 40, 55, 0.5, 1), ("tenor", 48, 64, 0.6, 2), ("alto", 55, 70, 0.7, 3), ("soprano", 62, 79, 0.9, 4)]


def _melody(rng, lo: int, hi: int, sec: float = 45.0) -> list[dict]:
    notes, t, m = [], 0.5, (lo + hi) // 2
    while t < sec:
        dur = float(rng.choice([0.15, 0.2, 0.3, 0.4, 0.6, 0.9, 1.4], p=[0.1, 0.15, 0.2, 0.2, 0.15, 0.12, 0.08]))
        last = m
        m = int(np.clip(m + rng.choice([-7, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 7]), lo, hi))
        gap = 0.0
        r = rng.random()
        if r < 0.15:
            gap = float(rng.uniform(0.25, 0.8))  # rest
        elif r < 0.5 or (notes and m == last):
            # consonant. A repeated pitch is always re-articulated: without a break
            # it is one held tone and no pitch-only method could see the onset.
            gap = float(rng.uniform(0.04, 0.08))
        glide = bool(notes and gap == 0.0 and rng.random() < 0.3)
        scoop = bool(rng.random() < 0.4)
        t += gap
        # Slides into the note last 80-300 ms: short portamento up to long scoops.
        slide = float(rng.uniform(0.08, 0.3)) if glide else 0.0
        notes.append({"start": t, "end": t + dur, "midi": m, "glide": glide, "slide": slide, "scoop": scoop, "gap": gap})
        t += dur
    return notes


def _render(notes: list[dict], vib: float, rng) -> np.ndarray:
    from scipy.signal import butter, lfilter

    n = int((notes[-1]["end"] + 0.5) * SR)
    f0 = np.zeros(n)
    amp = np.zeros(n)
    prev = None
    for nt in notes:
        a, b = int(nt["start"] * SR), int(nt["end"] * SR)
        t = np.arange(b - a) / SR
        mid = np.full(b - a, float(nt["midi"]))
        if nt["glide"] and prev is not None:
            g = min(len(t), int(nt["slide"] * SR))
            mid[:g] = prev + (nt["midi"] - prev) * np.linspace(0, 1, g)
        elif nt["scoop"]:
            g = min(len(t), int(0.06 * SR))
            mid[:g] -= 0.6 * np.linspace(1, 0, g)
        if t[-1] > 0.5:  # vibrato fades in after 0.3 s on longer notes
            rate = rng.uniform(5.0, 6.5)
            mid += vib * np.clip((t - 0.3) / 0.2, 0, 1) * np.sin(2 * np.pi * rate * t)
        mid += 0.05 * np.cumsum(rng.normal(0, 0.002, len(t)))  # slow drift, a few cents
        f0[a:b] = 440 * 2 ** ((mid - 69) / 12)
        env = np.ones(b - a)
        k = min(len(env) // 2, int(0.02 * SR))
        env[:k], env[len(env) - k:] = np.linspace(0, 1, k), np.linspace(1, 0, k)
        amp[a:b] = env
        prev = nt["midi"]
    phase = 2 * np.pi * np.cumsum(f0) / SR
    y = np.zeros(n)
    for k in range(1, 60):
        y += np.where(k * f0 < 7000, np.sin(k * phase) / k**1.1, 0)
    # vowel /a/ formants
    out = 0.3 * y
    for fc, bw in ((700, 130), (1220, 70), (2600, 160)):
        bb, aa = butter(2, [(fc - bw) / (SR / 2), (fc + bw) / (SR / 2)], btype="band")
        out += lfilter(bb, aa, y)
    out *= amp
    noise = rng.normal(0, 1, n)
    bb, aa = butter(2, [3000 / (SR / 2), 6000 / (SR / 2)], btype="band")
    cons = lfilter(bb, aa, noise)
    level = np.std(out[out != 0])
    for nt in notes:  # consonant noise in the short gaps
        if 0 < nt["gap"] < 0.1:
            a, b = int((nt["start"] - nt["gap"]) * SR), int(nt["start"] * SR)
            out[a:b] += 0.15 * level * cons[a:b] / np.std(cons)
    out += 10 ** (-40 / 20) * level * noise  # breath / room noise
    return (out / np.max(np.abs(out)) * 0.5).astype(np.float32)


def _voices(cfg: dict, device: str) -> list[dict]:
    import soundfile as sf

    out = []
    for name, lo, hi, vib, seed in VOICES:
        rng = np.random.default_rng(seed)
        notes = _melody(rng, lo, hi)
        y = _render(notes, vib, rng)
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / f"{name}.wav"
            sf.write(p, y, SR, subtype="PCM_16")
            tr = pitch.track(p, cfg["pitch"], device)
        truth = [Note(nt["start"], nt["end"], nt["midi"]) for nt in notes]
        out.append({"name": name, "truth": truth, "track": tr})
    return out


def _score(voice: dict, cfg: dict) -> dict:
    tr = voice["track"]
    hop = tr["hop"]
    voiced = pitch.voiced_mask(tr["f0"], tr["confidence"], cfg["pitch"])
    midi, _ = pitch.fix_octaves(pitch.midi_from_hz(tr["f0"]), voiced, hop, cfg["pitch"])
    cents = tuning.estimate_offset_cents(midi, voiced & (tr["confidence"] >= cfg["tuning"]["min_confidence"]))
    est = segment.segment(tuning.apply_offset(midi, cents), voiced, hop, cfg["segmentation"], tr["energy_db"])
    r = evaluate_notes(est, voice["truth"], max_lag_sec=0.3)
    r["tuning_cents"] = cents
    return r


KEYS = ("raw_pitch", "voicing_recall", "voicing_false_alarm", "onset_f", "note_f")

SWEEP = {
    "split_st": [0.5, 0.6, 0.7, 0.8, 0.9],
    "split_hold_sec": [0.03, 0.04, 0.06, 0.08, 0.1],
    "vibrato_sec": [0.06, 0.09, 0.12, 0.15, 0.18],
    "median_sec": [0.03, 0.05, 0.07],
    "gap_break_sec": [0.06, 0.1, 0.15],
    "min_note_sec": [0.05, 0.08, 0.1],
    "merge_gap_sec": [0.04, 0.08, 0.12],
    "glide_rate_st_per_sec": [6, 8, 12],
    "glide_min_sec": [0.12, 0.16, 0.2, 0.25],
    "glide_min_span_st": [1.5, 2.5, 3.5],
    "onset_dip_db": [0, 6, 8, 10, 12],
}


def run_benchmark(cfg: dict, device: str, sweep: bool = False) -> str:
    voices = _voices(cfg, device)
    lines = ["| voice | notes ref->pred | RPA | V rec | V FA | onset F | note F | tuning c |",
             "|---|---|---|---|---|---|---|---|"]
    rows = []
    for v in voices:
        r = _score(v, cfg)
        rows.append(r)
        lines.append(f"| {v['name']} | {r['ref_notes']}->{r['pred_notes']} | " +
                     " | ".join(f"{r[k]:.3f}" for k in KEYS) + f" | {r['tuning_cents']:+.0f} |")
    lines.append("| **mean** | | " + " | ".join(f"{np.mean([r[k] for r in rows]):.3f}" for k in KEYS) + " | |")
    if sweep:
        lines += ["", "Sweep (one threshold at a time, others at config values).", "",
                  "| threshold | value | note F mean | note F worst voice | onset F mean |", "|---|---|---|---|---|"]
        for key, values in SWEEP.items():
            for val in values:
                c = copy.deepcopy(cfg)
                c["segmentation"][key] = val
                rs = [_score(v, c) for v in voices]
                mark = " (current)" if cfg["segmentation"][key] == val else ""
                lines.append(f"| {key} | {val}{mark} | {np.mean([r['note_f'] for r in rs]):.3f} | "
                             f"{min(r['note_f'] for r in rs):.3f} | {np.mean([r['onset_f'] for r in rs]):.3f} |")
    return "\n".join(lines)
