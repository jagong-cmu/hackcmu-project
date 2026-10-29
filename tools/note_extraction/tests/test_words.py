"""words.json: onset snapping, splitting held words over notes, flags, site layout."""

from pathlib import Path

import yaml

from note_extraction.lyrics import Line, transfer_times
from note_extraction.notes import Note
from note_extraction.words import flagged, refine, report_md, to_site

CFG = yaml.safe_load((Path(__file__).resolve().parents[1] / "config.yaml").read_text())["words"]


def w(text, start, end, line=0, score=0.9):
    return {"text": text, "start": start, "end": end, "line": line, "score": score}


def test_start_snaps_to_onset_within_window_only():
    notes = [Note(1.05, 1.4, 60), Note(2.2, 2.5, 62)]
    out = refine([w("near", 1.0, 1.4), w("far", 2.0, 2.5)], notes, CFG)
    assert out[0]["start"] == 1.05  # 50 ms away: snapped
    assert out[1]["start"] == 2.0  # 200 ms away: left alone


def test_held_word_spans_its_notes():
    notes = [Note(1.0, 1.5, 60), Note(1.5, 2.0, 62), Note(2.0, 3.0, 64), Note(3.2, 3.6, 60)]
    out = refine([w("lo-ove", 1.0, 2.6), w("next", 3.2, 3.6)], notes, CFG)
    assert out[0]["notes"] == [[1.0, 1.5], [1.5, 2.0], [2.0, 3.0]]
    assert out[0]["end"] == 3.0  # the last note ran past the aligner's end
    assert "notes" not in out[1]  # one note: plain start..end


def test_word_never_runs_into_the_next():
    notes = [Note(1.0, 2.0, 60), Note(1.6, 2.4, 62)]
    out = refine([w("a", 1.0, 1.5), w("b", 1.6, 2.4)], notes, CFG)
    assert out[0]["end"] <= out[1]["start"]


def test_flags():
    out = refine([w("low", 1.0, 1.3, score=0.1), w("blip", 2.0, 2.03), w("hold", 3.0, 8.0),
                  w("lost", 9.0, 9.3, score=None)], [], CFG)
    assert [x["flags"] for x in out] == [["low_confidence"], ["short"], ["long"], ["untimed"]]


def test_site_layout_keeps_lines_and_offsets():
    words = refine([w("one", 1.0, 1.2, 0), w("two", 1.3, 1.5, 0), w("three", 3.0, 3.2, 1, score=0.1)], [], CFG)
    site = to_site(words, ["one two", "three"], 2.5, "whisperx")
    assert [ln["text"] for ln in site["lines"]] == ["one two", "three"]
    assert site["lines"][0]["words"][0]["start"] == 3.5
    assert [x["text"] for x in flagged(site)] == ["three"]
    assert "| 0:05.50 | three | 0.10 | low_confidence | three |" in report_md(site, "t")


def test_transfer_times_carries_scores_and_marks_spread_words():
    lines = [Line("I wish I was special", 0.0)]
    heard = [{"text": "I", "start": 0.0, "end": 0.2, "score": 0.8},
             {"text": "wish", "start": 0.2, "end": 0.5, "score": 0.7},
             {"text": "special", "start": 1.0, "end": 1.6, "score": 0.9}]
    out = transfer_times(lines, heard)
    assert [x.score for x in out] == [0.8, 0.7, None, None, 0.9]
