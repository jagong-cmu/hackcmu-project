"""Format conversion (site melody.json, UltraStar) and syllable assignment."""

import pytest

from note_extraction.export import from_site_melody, parse_ultrastar, to_site_melody, to_ultrastar
from note_extraction.lyrics import Line, Syllable, assign_syllables, parse_lyrics, transfer_times
from note_extraction.notes import Note


def notes():
    return [
        Note(1.00, 1.40, 60, "Hel", line_break=False),
        Note(1.40, 1.80, 62, "lo "),
        Note(2.00, 2.50, 64, "world ", line_break=False),
        Note(3.00, 3.30, 64, "a"),
        Note(3.30, 3.60, 64, "gain ", line_break=True),
    ]


def test_site_melody_matches_site_format_and_round_trips():
    mel = to_site_melody(notes(), site_offset_sec=0.5, frame_rate=50)
    assert set(mel) == {"sampleRateHz", "startSec", "hz"}
    assert mel["sampleRateHz"] == 50 and mel["startSec"] == 0
    # 1.00 s source + 0.5 s offset = frame 75, C4 = 261.63 Hz exactly as the site stores it
    assert mel["hz"][74] is None and mel["hz"][75] == 261.63
    back = from_site_melody(mel)
    # The two touching 64s (3.0-3.3, 3.3-3.6) stay two notes: one empty frame between them.
    assert [n.midi for n in back] == [60, 62, 64, 64, 64]
    for a, b in zip(notes(), back):
        assert abs(a.start + 0.5 - b.start) <= 0.02
    assert abs(back[-1].end - 4.1) <= 0.02


def test_negative_site_offset_drops_frames_before_zero():
    mel = to_site_melody([Note(0.0, 1.0, 60)], site_offset_sec=-0.5)
    assert mel["hz"][0] == 261.63 and mel["hz"][25] is None


def test_ultrastar_round_trip_and_conventions():
    meta = {"title": "T", "artist": "A", "audio_file": "instrumental.mp3"}
    txt = to_ultrastar(notes(), meta, site_offset_sec=0.5, bpm=1200)
    head = dict(l[1:].split(":", 1) for l in txt.splitlines() if l.startswith("#"))
    assert head["VERSION"] == "1.1.0" and head["AUDIO"] == "instrumental.mp3" and head["BPM"] == "1200"
    assert head["GAP"] == "1500"  # first note at 1.0 s source + 0.5 s offset
    assert ": 0 32 0 Hel" in txt  # C4 = pitch 0; 0.4 s / 12.5 ms = 32 beats
    assert txt.rstrip().endswith("E") and "\n- " in txt
    back, tags = parse_ultrastar(txt)
    assert [n.midi for n in back] == [n.midi for n in notes()]
    assert [n.syllable for n in back] == [n.syllable for n in notes()]
    for a, b in zip(notes(), back):
        assert abs(a.start + 0.5 - b.start) <= 0.0125 and abs(a.end + 0.5 - b.end) <= 0.0125
    assert back[4].line_break


def test_ultrastar_parses_a_typical_handwritten_file():
    txt = "#TITLE:x\n#ARTIST:y\n#MP3:x.mp3\n#BPM:300,5\n#GAP:2000\n: 0 4 5 Hel\n* 4 4 7 lo \n- 10\nF 12 2 0 hey\nE\n"
    ns, _ = parse_ultrastar(txt)
    beat = 15 / 300.5
    assert [n.midi for n in ns] == [65, 67, 60]
    assert ns[1].flags == ["golden"] and ns[2].flags == ["freestyle"] and ns[2].line_break
    assert ns[0].start == pytest.approx(2.0) and ns[2].start == pytest.approx(2.0 + 12 * beat)


def test_one_syllable_over_several_notes_gets_tildes():
    ns = [Note(0.0, 0.3, 60), Note(0.3, 0.6, 62), Note(0.6, 0.9, 64)]
    out, unplaced = assign_syllables(ns, [Syllable("love ", 0.0, 0.9, 0)])
    assert [n.syllable for n in out] == ["love ", "~", "~"]
    assert "held" in out[1].flags and not unplaced


def test_several_syllables_in_one_note_split_it():
    out, _ = assign_syllables([Note(0.0, 0.9, 60)],
                              [Syllable("a", 0.0, 0.3, 0), Syllable("b", 0.3, 0.6, 0), Syllable("c ", 0.6, 0.9, 0)])
    assert [n.syllable for n in out] == ["a", "b", "c "]
    assert all(n.midi == 60 and "split-syllable" in n.flags for n in out)
    assert out[0].start == 0.0 and out[-1].end == 0.9 and out[1].start == pytest.approx(0.3)


def test_line_breaks_follow_lyric_lines():
    ns = [Note(0.0, 0.3, 60), Note(0.5, 0.8, 62), Note(2.0, 2.3, 64)]
    sy = [Syllable("one ", 0.0, 0.3, 0), Syllable("two ", 0.5, 0.8, 0), Syllable("three ", 2.0, 2.3, 1)]
    out, _ = assign_syllables(ns, sy)
    assert [n.line_break for n in out] == [False, False, True]


def test_parse_lrc_strips_duet_prefix_and_shifts_onto_source(tmp_path):
    p = tmp_path / "l.lrc"
    p.write_text("[00:23.06]A: When you were here before\n[00:27.99]AB: Couldn't look\n[01:00.00]\n")
    lines = parse_lyrics(p, lrc_offset_sec=3.0)
    assert [ln.text for ln in lines] == ["When you were here before", "Couldn't look"]
    assert lines[0].start == pytest.approx(20.06)


def test_transfer_times_matches_words_and_fills_gaps():
    heard = [{"text": "hello", "start": 1.0, "end": 1.4}, {"text": "world", "start": 2.0, "end": 2.4}]
    words = transfer_times([Line("Hello big world")], heard)
    assert [w.text for w in words] == ["Hello", "big", "world"]
    assert words[0].start == 1.0 and 1.4 <= words[1].start < words[2].start == 2.0
