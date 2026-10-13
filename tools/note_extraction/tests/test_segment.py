"""Segmentation, octave repair and tuning on small synthetic MIDI curves."""

from pathlib import Path

import numpy as np
import pytest
import yaml

from note_extraction.pitch import fix_octaves
from note_extraction.segment import segment
from note_extraction.tuning import apply_offset, estimate_offset_cents

HOP = 0.01
CFG = yaml.safe_load((Path(__file__).resolve().parents[1] / "config.yaml").read_text())
SEG, PITCH = CFG["segmentation"], CFG["pitch"]


def curve(*parts):
    """parts: (midi | None | callable(t), seconds). Returns (midi, voiced)."""
    out = []
    for value, sec in parts:
        n = int(round(sec / HOP))
        t = np.arange(n) * HOP
        if value is None:
            out.append(np.full(n, np.nan))
        elif callable(value):
            out.append(value(t))
        else:
            out.append(np.full(n, float(value)))
    m = np.concatenate(out)
    return m, ~np.isnan(m)


def test_clean_sequence_of_known_notes():
    m, v = curve((60, 0.5), (62, 0.5), (64, 0.5), (None, 0.3), (65, 0.4))
    notes = segment(m, v, HOP, SEG)
    assert [n.midi for n in notes] == [60, 62, 64, 65]
    expected = [(0.0, 0.5), (0.5, 1.0), (1.0, 1.5), (1.8, 2.2)]
    for n, (a, b) in zip(notes, expected):
        assert abs(n.start - a) <= 0.03 and abs(n.end - b) <= 0.03


@pytest.mark.parametrize("depth", [0.5, 0.8])
def test_vibrato_stays_one_note(depth):
    m, v = curve((lambda t: 62 + depth * np.sin(2 * np.pi * 5.5 * t), 2.0))
    notes = segment(m, v, HOP, SEG)
    assert [n.midi for n in notes] == [62]
    assert not any("glide" in n.flags for n in notes)


def test_glide_becomes_flagged_short_notes():
    m, v = curve((60, 0.5), (lambda t: 60 + 7 * t / 0.5, 0.5), (67, 0.5))
    notes = segment(m, v, HOP, SEG)
    assert notes[0].midi == 60 and notes[-1].midi == 67
    middle = notes[1:-1]
    assert middle and all("glide" in n.flags for n in middle)
    midis = [n.midi for n in notes]
    assert midis == sorted(midis), "a rising slide must not step down"


def test_single_octave_error_frame_is_repaired_and_does_not_split():
    m, v = curve((57, 1.0))
    m[50] += 12
    fixed, count = fix_octaves(m, v, HOP, PITCH)
    assert count == 1 and fixed[50] == 57
    assert [n.midi for n in segment(m, v, HOP, SEG)] == [57]  # hold rule alone also ignores it


def test_real_octave_leap_survives_repair():
    m, v = curve((57, 1.0), (69, 1.0))
    fixed, _ = fix_octaves(m, v, HOP, PITCH)
    assert [n.midi for n in segment(fixed, v, HOP, SEG)] == [57, 69]


def test_short_notes_dropped_and_same_pitch_gaps_merged():
    m, v = curve((60, 0.5), (None, 0.05), (60, 0.5), (None, 0.2), (64, 0.05), (None, 0.2), (60, 0.4))
    notes = segment(m, v, HOP, SEG)
    # 50 ms gap: bridged into one note. 50 ms blip at 64: dropped. 200 ms gaps: separate notes.
    assert [n.midi for n in notes] == [60, 60]
    assert abs(notes[0].end - 1.05) <= 0.03


def test_long_gap_splits_even_at_same_pitch():
    m, v = curve((60, 0.5), (None, 0.15), (60, 0.5))
    assert len(segment(m, v, HOP, SEG)) == 2


def test_tuning_offset_and_circular_wrap():
    m, v = curve((lambda t: 60.3 + 0.02 * np.sin(t * 9), 2.0))
    assert abs(estimate_offset_cents(m, v) - 30) <= 2
    # -45 and +45 cents are 10 cents apart around the circle: the answer is near 50, not 0.
    w = np.concatenate([np.full(100, 60.45), np.full(100, 61.55)])
    assert abs(abs(estimate_offset_cents(w, np.ones(200, bool))) - 50) <= 6
    assert np.allclose(apply_offset(np.array([60.3]), 30), 60.0)
