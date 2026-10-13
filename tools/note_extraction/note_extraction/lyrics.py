"""Stage 5: word timings (WhisperX), syllables (pyphen), and syllable -> note assignment."""

from __future__ import annotations

import difflib
import logging
import re
from dataclasses import dataclass
from pathlib import Path

from .notes import Note

log = logging.getLogger(__name__)

_LRC = re.compile(r"^\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\](.*)$")
_DUET = re.compile(r"^\s*(?:A|B|AB|P1|P2)\s*:\s*", re.I)


@dataclass
class Line:
    text: str
    start: float | None = None  # source timeline, when the lyrics carry times


@dataclass
class Word:
    text: str
    start: float
    end: float
    line: int


def parse_lyrics(path: Path, lrc_offset_sec: float = 0.0) -> list[Line]:
    """Plain text (one line per lyric line) or LRC. LRC times are moved onto the
    source timeline by subtracting lrc_offset_sec (LRC time = source + offset).
    Duet prefixes like "A:" / "AB:" are dropped."""
    lines: list[Line] = []
    for raw in Path(path).read_text(encoding="utf-8").splitlines():
        m = _LRC.match(raw.strip())
        if m:
            text = _DUET.sub("", m.group(4)).strip()
            if text:
                frac = int((m.group(3) or "0").ljust(3, "0")) / 1000
                t = int(m.group(1)) * 60 + int(m.group(2)) + frac
                lines.append(Line(text, t - lrc_offset_sec))
        elif raw.strip() and not raw.strip().startswith("["):
            lines.append(Line(_DUET.sub("", raw).strip()))
    return lines


def _norm(w: str) -> str:
    return re.sub(r"[^a-z0-9']", "", w.lower())


# ------------------------------------------------------------------ word timing

def _whisperx_words(vocals: Path, lines: list[Line], cfg: dict, device: str, transcribe: bool) -> list[dict]:
    import whisperx

    audio = whisperx.load_audio(str(vocals))
    dur = len(audio) / 16000
    # faster-whisper has no MPS backend; wav2vec2 alignment is quick on CPU.
    dev = "cuda" if device == "cuda" else "cpu"
    if transcribe:
        model = whisperx.load_model(cfg["whisper_model"], dev, compute_type="int8" if dev == "cpu" else "float16",
                                    language=cfg["language"], vad_method="silero")
        segments = model.transcribe(audio, batch_size=8, language=cfg["language"])["segments"]
    else:
        segments = []
        for i, ln in enumerate(lines):
            nxt = lines[i + 1].start if i + 1 < len(lines) else None
            end = min(nxt if nxt is not None else dur, ln.start + 12, dur)
            segments.append({"text": ln.text, "start": max(0.0, ln.start), "end": max(end, ln.start + 0.5)})
    align_model, meta = whisperx.load_align_model(language_code=cfg["language"], device=dev)
    result = whisperx.align(segments, align_model, meta, audio, dev, return_char_alignments=False)
    words = []
    for seg in result["segments"]:
        for w in seg.get("words", []):
            words.append({"text": w["word"], "start": w.get("start"), "end": w.get("end")})
    _fill_missing_times(words)
    return words


def _fill_missing_times(words: list[dict]) -> None:
    """Words WhisperX could not time (numbers, symbols) get their neighbours' gap."""
    for i, w in enumerate(words):
        if w["start"] is None or w["end"] is None:
            prev = next((words[j]["end"] for j in range(i - 1, -1, -1) if words[j]["end"] is not None), 0.0)
            nxt = next((words[j]["start"] for j in range(i + 1, len(words)) if words[j]["start"] is not None), prev + 0.3)
            w["start"], w["end"] = prev, max(prev + 0.05, nxt)


def transfer_times(lines: list[Line], heard: list[dict]) -> list[Word]:
    """Give the supplied lyric words the times of the heard/aligned words they match.
    Unmatched words are spread evenly between the matched words around them."""
    given = [(t, li) for li, ln in enumerate(lines) for t in ln.text.split()]
    a = [_norm(t) for t, _ in given]
    b = [_norm(h["text"]) for h in heard]
    times: list[tuple[float, float] | None] = [None] * len(given)
    for blk in difflib.SequenceMatcher(None, a, b, autojunk=False).get_matching_blocks():
        for k in range(blk.size):
            h = heard[blk.b + k]
            times[blk.a + k] = (h["start"], h["end"])
    out: list[Word] = []
    i = 0
    while i < len(given):
        if times[i] is not None:
            out.append(Word(given[i][0], *times[i], given[i][1]))
            i += 1
            continue
        j = i
        while j < len(given) and times[j] is None:
            j += 1
        n = j - i
        lo = times[i - 1][1] if i > 0 else (times[j][0] - 0.3 * n if j < len(given) else 0.0)
        hi = times[j][0] if j < len(given) else lo + 0.3 * n
        step = max(hi - lo, 0.05 * n) / n
        for k in range(i, j):
            s = lo + (k - i) * step
            out.append(Word(given[k][0], s, s + step, given[k][1]))
        i = j
    return out


def word_timings(vocals: Path, lines: list[Line], cfg: dict, device: str) -> tuple[list[Word], bool]:
    """(words, auto_generated). Timed lines (LRC) are force-aligned; plain lines are
    matched onto a transcript; no lines means the transcript is the lyrics."""
    if lines and all(ln.start is not None for ln in lines):
        return transfer_times(lines, _whisperx_words(vocals, lines, cfg, device, transcribe=False)), False
    heard = _whisperx_words(vocals, lines, cfg, device, transcribe=True)
    if lines:
        return transfer_times(lines, heard), False
    words, line = [], 0
    for i, h in enumerate(heard):
        if i and h["start"] - heard[i - 1]["end"] >= cfg["phrase_gap_sec"]:
            line += 1
        words.append(Word(h["text"].strip(), h["start"], h["end"], line))
    return words, True


# ------------------------------------------------------------------ syllables

def syllabify(word: str, dic) -> list[str]:
    """pyphen split; punctuation stays on the last piece; whole word if splitting fails."""
    core = re.sub(r"[^\w']+$", "", word)
    tail = word[len(core):]
    try:
        parts = [p for p in dic.inserted(core).split("-") if p] if core else []
    except Exception:
        parts = []
    if not parts:
        return [word]
    parts[-1] += tail
    return parts


@dataclass
class Syllable:
    text: str
    start: float
    end: float
    line: int


def to_syllables(words: list[Word], lang: str) -> list[Syllable]:
    import pyphen

    dic = pyphen.Pyphen(lang=lang)
    out = []
    for w in words:
        parts = syllabify(w.text, dic)
        total = sum(len(p) for p in parts)
        t = w.start
        for k, p in enumerate(parts):
            d = (w.end - w.start) * len(p) / total
            # UltraStar convention: a trailing space ends the word.
            out.append(Syllable(p + (" " if k == len(parts) - 1 else ""), t, t + d, w.line))
            t += d
    return out


# ------------------------------------------------------------------ assignment

def _overlap(a0: float, a1: float, b0: float, b1: float) -> float:
    return max(0.0, min(a1, b1) - max(a0, b0))


def assign_syllables(notes: list[Note], sylls: list[Syllable], snap_sec: float = 0.3) -> tuple[list[Note], list[Syllable]]:
    """Returns (notes with syllables, syllables that found no note).

    Each syllable goes to the note it overlaps most (or the nearest onset within
    snap_sec). One syllable over several notes: the syllable on the first, "~"
    (flag held) on the rest. Several syllables in one note: the note is split at
    the syllable boundaries and flagged split-syllable. A note starting a new
    lyric line gets line_break.
    """
    notes = sorted(notes, key=lambda n: n.start)
    owner: dict[int, list[Syllable]] = {}
    unplaced: list[Syllable] = []
    for s in sylls:
        ovs = []
        for i, n in enumerate(notes):
            if n.start > s.end + snap_sec:
                break
            ov = _overlap(s.start, s.end, n.start, n.end)
            if ov > 0:
                ovs.append((i, ov))
        # A syllable held over several notes belongs to the first of them, not
        # whichever overlaps a hair more; a sliver of the previous note does not count.
        top = max((ov for _, ov in ovs), default=0.0)
        best = next((i for i, ov in ovs if ov >= 0.5 * top), None)
        if best is None:
            near = [(abs(n.start - s.start), i) for i, n in enumerate(notes) if abs(n.start - s.start) <= snap_sec]
            best = min(near)[1] if near else None
        if best is None:
            unplaced.append(s)
        else:
            owner.setdefault(best, []).append(s)

    out: list[Note] = []
    lines: list[int | None] = []
    last_end = -1.0
    for i, n in enumerate(notes):
        ss = owner.get(i, [])
        if len(ss) == 1:
            n.syllable = ss[0].text
            out.append(n)
            lines.append(ss[0].line)
            last_end = ss[0].end
        elif len(ss) > 1:
            cuts = [n.start] + [min(max(s.start, n.start), n.end) for s in ss[1:]] + [n.end]
            if any(b - a < 0.02 for a, b in zip(cuts, cuts[1:])):  # collapsed times: split evenly
                step = n.dur / len(ss)
                cuts = [n.start + k * step for k in range(len(ss))] + [n.end]
            for k, s in enumerate(ss):
                out.append(Note(cuts[k], cuts[k + 1], n.midi, s.text, False, sorted(set(n.flags) | {"split-syllable"})))
                lines.append(s.line)
            last_end = ss[-1].end
        else:
            if out and out[-1].syllable is not None and n.start <= max(last_end, out[-1].end) + 0.15:
                n.syllable = "~"
                n.flags = sorted(set(n.flags) | {"held"})
            out.append(n)
            lines.append(None)

    seen = None
    for n, ln in zip(out, lines):
        if ln is None:
            continue
        if seen is not None and ln != seen:
            n.line_break = True
        seen = ln
    return out, unplaced


def align_lyrics(notes: list[Note], vocals: Path, lyrics_path: Path | None, lrc_offset_sec: float,
                 cfg: dict, device: str) -> tuple[list[Note], dict]:
    lines = parse_lyrics(lyrics_path, lrc_offset_sec) if lyrics_path else []
    words, auto = word_timings(vocals, lines, cfg, device)
    sylls = to_syllables(words, cfg["hyphen_dict"])
    out, unplaced = assign_syllables(notes, sylls)
    info = {
        "lyrics_auto_generated": auto,
        "lines": [ln.text for ln in lines] if lines else None,
        "words": [w.__dict__ for w in words],
        "syllables": len(sylls),
        "unplaced_syllables": [{"text": s.text, "start": s.start, "end": s.end} for s in unplaced],
    }
    return out, info
