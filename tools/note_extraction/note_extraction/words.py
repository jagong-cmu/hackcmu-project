"""Word timings for the site's lyric highlight (words.json) and the per-song align report.

Aligned words (stage 5) are refined with the segmented notes: a word's start
snaps to a nearby note onset, and a word sung over several notes carries each
note's span so the site fills it note by note instead of linearly.
"""

from __future__ import annotations

from .notes import Note


def refine(words: list[dict], notes: list[Note], cfg: dict) -> list[dict]:
    """words: stage-5 dicts (text, start, end, line, score), source timeline, in order.
    Returns copies with start snapped, end and "notes" from the notes they span, and "flags"."""
    snap = cfg["snap_sec"]
    onsets = sorted(n.start for n in notes)
    out = [dict(w) for w in words]
    for i, w in enumerate(out):
        near = min(onsets, key=lambda t: abs(t - w["start"]), default=None)
        prev = out[i - 1]["start"] if i else float("-inf")
        if near is not None and abs(near - w["start"]) <= snap and prev < near < w["end"]:
            w["start"] = near
    for i, w in enumerate(out):
        nxt = out[i + 1]["start"] if i + 1 < len(out) else float("inf")
        if nxt <= w["start"]:  # collapsed neighbour; leave this word's own times alone
            nxt = float("inf")
        parts = [[max(n.start, w["start"]), min(n.end, nxt)] for n in sorted(notes, key=lambda n: n.start)
                 if w["start"] - snap <= n.start < w["end"] and n.end > w["start"]]
        parts = [p for p in parts if p[1] > p[0]]
        if parts:
            w["end"] = min(max(w["end"], parts[-1][1]), nxt)
        if len(parts) > 1:
            w["notes"] = parts
        dur = w["end"] - w["start"]
        score = w.get("score")
        w["flags"] = ((["untimed"] if score is None else ["low_confidence"] if score < cfg["low_score"] else [])
                      + (["short"] if dur < cfg["min_word_sec"] else [])
                      + (["long"] if dur > cfg["max_word_sec"] else []))
    return out


def to_site(words: list[dict], lines: list[str] | None, offset_sec: float, aligner: str) -> dict:
    """words.json: one entry per lyric line, each with its words on the karaoke timeline.
    lines: the lyric lines' text, or None for transcribed lyrics (text rebuilt from the words)."""
    n = max((w["line"] for w in words), default=-1) + 1
    by_line: list[list[dict]] = [[] for _ in range(max(n, len(lines or [])))]
    for w in words:
        site = {"text": w["text"], "start": round(w["start"] + offset_sec, 3), "end": round(w["end"] + offset_sec, 3),
                "score": None if w.get("score") is None else round(w["score"], 3), "flags": w["flags"]}
        if "notes" in w:
            site["notes"] = [[round(a + offset_sec, 3), round(b + offset_sec, 3)] for a, b in w["notes"]]
        by_line[w["line"]].append(site)
    texts = lines or [" ".join(w["text"] for w in ws) for ws in by_line]
    return {"version": 1, "aligner": aligner,
            "lines": [{"text": t, "words": ws} for t, ws in zip(texts, by_line)]}


def flagged(site: dict) -> list[dict]:
    return [{**w, "line": ln["text"]} for ln in site["lines"] for w in ln["words"] if w["flags"]]


def report_md(site: dict, title: str) -> str:
    words = [w for ln in site["lines"] for w in ln["words"]]
    bad = flagged(site)
    out = [f"# Word alignment: {title}", "",
           f"Aligner: {site['aligner']}. Times are on the karaoke track (site timeline).", "",
           f"- **words**: {len(words)}", f"- **flagged**: {len(bad)}", ""]
    if bad:
        out += ["## Check by ear", "", "| time | word | score | flags | line |", "|---|---|---|---|---|"]
        for w in bad:
            score = "–" if w["score"] is None else f"{w['score']:.2f}"
            out.append(f"| {_mmss(w['start'])} | {w['text']} | {score} | {', '.join(w['flags'])} | {w['line']} |")
    return "\n".join(out) + "\n"


def _mmss(t: float) -> str:
    return f"{int(t // 60)}:{t % 60:05.2f}"
