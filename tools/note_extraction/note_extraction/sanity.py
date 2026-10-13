"""Automatic sanity report: flags, per-section "needs review" scores, song summary."""

from __future__ import annotations

import numpy as np

from .notes import Note

# Section "needs review" score, capped at 100.
# Rare, serious flags add their weight per occurrence.
PER_FLAG = {
    "out_of_range": 40,
    "big_jump": 30,
    "long_unvoiced_in_line": 25,
    "unplaced_syllable": 15,
}
# Common flags (every sung vocal has some) add weight x the share of the
# section's voiced time they cover, so a section only scores high when they
# dominate it.
BY_COVERAGE = {
    "pitch_unstable": 60,
    "low_confidence": 60,
    "note_without_syllable": 40,
    "glide": 30,
    "split_syllable": 20,
}


def report(notes: list[Note], curve: dict, info: dict, cfg: dict) -> dict:
    """curve: {midi, voiced, confidence, hop} on the source timeline.
    info: tuning_cents, tuning_review, octave_fixes, bleed_share, warnings, lyrics (stage-5 info or None)."""
    hop = curve["hop"]
    midi, voiced, conf = curve["midi"], curve["voiced"], curve["confidence"]
    flags: list[dict] = []

    def flag(kind, start, end, detail):
        flags.append({"start": round(start, 3), "end": round(end, 3), "kind": kind, "detail": detail})

    ordered = sorted(notes, key=lambda n: n.start)
    for n in ordered:
        if n.midi < cfg["min_midi"] or n.midi > cfg["max_midi"]:
            flag("out_of_range", n.start, n.end, f"MIDI {n.midi} outside {cfg['min_midi']}..{cfg['max_midi']}")
        if "glide" in n.flags:
            flag("glide", n.start, n.end, "slide emitted as short notes")
        if "split-syllable" in n.flags:
            flag("split_syllable", n.start, n.end, f"note split for '{(n.syllable or '').strip()}'")
        a, b = int(n.start / hop), max(int(n.start / hop) + 1, int(n.end / hop))
        seg = midi[a:b]
        seg = seg[~np.isnan(seg)]
        if seg.size and np.mean(np.abs(seg - n.midi) > 0.7) > 0.4:
            flag("pitch_unstable", n.start, n.end, f"curve strays >0.7 st from {n.midi} on {np.mean(np.abs(seg - n.midi) > 0.7):.0%} of frames")
        if conf[a:b].size and float(np.mean(conf[a:b])) < 0.3:
            flag("low_confidence", n.start, n.end, f"mean tracker confidence {np.mean(conf[a:b]):.2f}")
    for p, n in zip(ordered, ordered[1:]):
        if abs(n.midi - p.midi) > cfg["max_jump_st"] and n.start - p.end < 1.0:
            flag("big_jump", p.start, n.end, f"{p.midi} -> {n.midi} ({n.midi - p.midi:+d} st)")

    lyr = info.get("lyrics")
    with_syll = sum(1 for n in notes if n.syllable and n.syllable != "~")
    no_syll = [n for n in ordered if n.syllable is None]
    if lyr:
        for n in no_syll:
            flag("note_without_syllable", n.start, n.end, f"MIDI {n.midi} has no lyric")
        for s in lyr["unplaced_syllables"]:
            flag("unplaced_syllable", s["start"], s["end"], f"'{s['text'].strip()}' found no note")
        # Long unvoiced stretches inside a lyric line.
        by_line: dict[int, list[dict]] = {}
        for w in lyr["words"]:
            by_line.setdefault(w["line"], []).append(w)
        for ws in by_line.values():
            a, b = int(ws[0]["start"] / hop), int(ws[-1]["end"] / hop)
            run_start = None
            for i in range(a, min(b, len(voiced))):
                if not voiced[i] and run_start is None:
                    run_start = i
                if (voiced[i] or i == b - 1) and run_start is not None:
                    if (i - run_start) * hop >= cfg["long_unvoiced_sec"]:
                        flag("long_unvoiced_in_line", run_start * hop, i * hop, f"{(i - run_start) * hop:.1f}s silent inside a lyric line")
                    run_start = None

    total = len(midi) * hop
    sections = []
    step = cfg["section_sec"]
    for s0 in np.arange(0, max(total, step), step):
        s1 = s0 + step
        inside = [f for f in flags if f["start"] < s1 and f["end"] > s0]
        voiced_sec = max(1.0, float(np.sum(voiced[int(s0 / hop) : int(s1 / hop)])) * hop)
        score = sum(PER_FLAG.get(f["kind"], 0) for f in inside)
        for kind, w in BY_COVERAGE.items():
            covered = sum(min(f["end"], s1) - max(f["start"], s0) for f in inside if f["kind"] == kind)
            score += w * min(1.0, covered / voiced_sec)
        score = min(100, round(score))
        reasons = sorted({f["kind"] for f in inside})
        sections.append({"start": float(s0), "end": float(s1), "score": int(score), "reasons": reasons})

    summary = {
        "notes": len(notes),
        "voiced_fraction": round(float(np.mean(voiced)) if len(voiced) else 0.0, 3),
        "tuning_cents": info.get("tuning_cents"),
        "tuning_needs_review": info.get("tuning_review", False),
        "octave_fixes": info.get("octave_fixes"),
        "bleed_share": info.get("bleed_share"),
        "warnings": info.get("warnings", []),
        "flag_counts": {k: sum(1 for f in flags if f["kind"] == k) for k in sorted({f["kind"] for f in flags})},
    }
    if lyr:
        summary.update({
            "lyrics_auto_generated": lyr["lyrics_auto_generated"],
            "syllables": lyr["syllables"],
            "notes_with_syllable": with_syll,
            "notes_without_syllable": len(no_syll),
            "unplaced_syllables": len(lyr["unplaced_syllables"]),
            "syllable_note_mismatch": lyr["syllables"] - with_syll,
        })
    return {"summary": summary, "flags": flags, "sections": sections}


def to_markdown(rep: dict, title: str, site_offset_sec: float) -> str:
    s = rep["summary"]
    out = [f"# Sanity report: {title}", "",
           "Times are on the karaoke track (site timeline).", ""]
    for k, v in s.items():
        if k not in ("warnings", "flag_counts"):
            out.append(f"- **{k}**: {v}")
    if s.get("tuning_needs_review"):
        out.append("- **tuning offset is large: check for a pitch-shifted or non-A440 track**")
    for w in s["warnings"]:
        out.append(f"- warning: {w}")
    out += ["", "## Flags by kind", ""]
    out += [f"- {k}: {v}" for k, v in s["flag_counts"].items()] or ["- none"]
    out += ["", "## Listen first (highest review score)", "", "| section | score | reasons |", "|---|---|---|"]
    for sec in sorted(rep["sections"], key=lambda x: -x["score"])[:10]:
        if sec["score"] == 0:
            break
        a, b = sec["start"] + site_offset_sec, sec["end"] + site_offset_sec
        out.append(f"| {_mmss(a)}–{_mmss(b)} | {sec['score']} | {', '.join(sec['reasons'])} |")
    return "\n".join(out) + "\n"


def _mmss(t: float) -> str:
    t = max(0.0, t)
    return f"{int(t // 60)}:{t % 60:04.1f}"
