"""Stage 6: notes -> the site's melody.json, UltraStar .txt; and the readers for both.

Site format (packages/shared MelodyFile): {sampleRateHz, startSec, hz: (number|null)[]}.
One value per 1/sampleRateHz s on the KARAOKE TRACK's timeline: the note's
equal-tempered Hz (2 decimals), or null where nothing is sung. The site turns
it back into notes by grouping equal neighbouring values (pitchGuide.segmentMelody).
"""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np

from .notes import Note, hz_from_midi


# ------------------------------------------------------------------ site format

def to_site_melody(notes: list[Note], site_offset_sec: float, frame_rate: int = 50) -> dict:
    """site time = source time + site_offset_sec. Frames before 0 are dropped."""
    if not notes:
        return {"sampleRateHz": frame_rate, "startSec": 0, "hz": []}
    end = max(n.end for n in notes) + site_offset_sec
    hz: list[float | None] = [None] * (int(math.ceil(end * frame_rate)) + frame_rate)
    ordered = sorted(notes, key=lambda n: n.start)
    for i, n in enumerate(ordered):
        a = int(round((n.start + site_offset_sec) * frame_rate))
        b = int(round((n.end + site_offset_sec) * frame_rate))
        nxt = ordered[i + 1] if i + 1 < len(ordered) else None
        # Two touching notes of the same pitch would read as one held note on the
        # site; leave one empty frame so the second onset survives.
        if nxt and nxt.midi == n.midi and int(round((nxt.start + site_offset_sec) * frame_rate)) <= b:
            b -= 1
        value = round(hz_from_midi(n.midi), 2)
        for k in range(max(a, 0), max(b, 0)):
            if k < len(hz):
                hz[k] = value
    return {"sampleRateHz": frame_rate, "startSec": 0, "hz": hz}


def from_site_melody(melody: dict) -> list[Note]:
    """Group equal neighbouring frames back into notes (site timeline)."""
    fr, t0 = melody["sampleRateHz"], melody.get("startSec", 0)
    out: list[Note] = []
    prev = None
    for i, v in enumerate(melody["hz"]):
        if v is None or v <= 0:
            prev = None
            continue
        midi = int(round(69 + 12 * math.log2(v / 440)))
        if prev is not None and prev.midi == midi:
            prev.end = t0 + (i + 1) / fr
            continue
        prev = Note(t0 + i / fr, t0 + (i + 1) / fr, midi)
        out.append(prev)
    return out


# ------------------------------------------------------------------ UltraStar

def to_ultrastar(notes: list[Note], meta: dict, site_offset_sec: float, bpm: float = 1200) -> str:
    """UltraStar 1.1.0. Beat = 15 / bpm s. #GAP (ms) is beat 0 on the audio file's
    timeline, which is the site's backing track, so times are shifted like melody.json."""
    beat = 15.0 / bpm
    ordered = sorted(notes, key=lambda n: n.start)
    if not ordered:
        raise ValueError("no notes to export")
    gap_sec = ordered[0].start + site_offset_sec
    audio = meta.get("audio_file", "instrumental.mp3")
    lines = [
        "#VERSION:1.1.0",
        f"#TITLE:{meta.get('title', '')}",
        f"#ARTIST:{meta.get('artist', '')}",
        f"#AUDIO:{audio}",
        f"#MP3:{audio}",  # pre-1.1 readers only know #MP3
        f"#BPM:{bpm:g}",
        f"#GAP:{round(gap_sec * 1000)}",
        "#CREATOR:note_extraction (auto, unreviewed)" if not meta.get("reviewed") else "#CREATOR:note_extraction",
    ]
    if meta.get("lyrics_auto_generated"):
        lines.append("#COMMENT:lyrics auto-transcribed, unreviewed")
    prev_end = None
    for n in ordered:
        start = int(round((n.start + site_offset_sec - gap_sec) / beat))
        length = max(1, int(round(n.dur / beat)))
        if n.line_break and prev_end is not None:
            lines.append(f"- {min(prev_end, start)}")
        kind = "F" if "freestyle" in n.flags else ("*" if "golden" in n.flags else ":")
        text = n.syllable if n.syllable is not None else "~"
        lines.append(f"{kind} {start} {length} {n.midi - 60} {text}")
        prev_end = start + length
    lines.append("E")
    return "\n".join(lines) + "\n"


def parse_ultrastar(text: str) -> tuple[list[Note], dict]:
    """Notes on the audio file's timeline (seconds), and the header tags."""
    tags: dict[str, str] = {}
    raw: list[tuple[str, int, int, int, str]] = []
    breaks: set[int] = set()
    for line in text.splitlines():
        if line.startswith("#"):
            k, _, v = line[1:].partition(":")
            tags[k.strip().upper()] = v.strip()
        elif line[:1] in ":*FRG" and line[1:2] == " ":
            kind, start, length, pitch, *rest = line.split(" ", 4)
            raw.append((kind, int(start), int(length), int(pitch), rest[0] if rest else ""))
        elif line.startswith("-"):
            breaks.add(len(raw))
        elif line.startswith("E"):
            break
    if "RELATIVE" in tags and tags["RELATIVE"].lower() == "yes":
        raise ValueError("RELATIVE UltraStar files are not supported")
    bpm = float(tags["BPM"].replace(",", "."))
    gap = float(tags.get("GAP", "0").replace(",", ".")) / 1000
    beat = 15.0 / bpm
    notes = []
    for i, (kind, s, ln, p, txt) in enumerate(raw):
        flags = {"*": ["golden"], "F": ["freestyle"], "R": ["rap"], "G": ["rap", "golden"]}.get(kind, [])
        notes.append(Note(gap + s * beat, gap + (s + ln) * beat, p + 60, txt, i in breaks, flags))
    return notes, tags


# ------------------------------------------------------------------ shared helpers

def notes_to_curve(notes: list[Note], hop: float, length_sec: float) -> np.ndarray:
    """Frame grid of MIDI (NaN = no note), for evaluation and the site export check."""
    out = np.full(int(math.ceil(length_sec / hop)), np.nan)
    for n in notes:
        a, b = max(0, int(round(n.start / hop))), min(len(out), int(round(n.end / hop)))
        out[a:b] = n.midi
    return out


def write_json(path: Path, obj) -> None:
    import json

    Path(path).write_text(json.dumps(obj, separators=(",", ":"), ensure_ascii=False))
