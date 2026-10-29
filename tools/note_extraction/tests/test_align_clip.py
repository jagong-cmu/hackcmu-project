"""Forced alignment end to end on a synthetic clip with known word times.

The clip is built from macOS `say`, one word at a time with known silences
between, so every word's true start is exact. Skips without `say` or without
the aligner installed; downloads the aligner model on first run.
"""

import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf
import yaml

from note_extraction.lyrics import Line, word_timings

CFG = yaml.safe_load((Path(__file__).resolve().parents[1] / "config.yaml").read_text())["lyrics"]
LINES = [["hello", "world"], ["this", "is", "a", "simple", "test"]]
SR = 16000
# Measured with WhisperX on this clip: 2-60 ms on most words, ~130-160 ms late on
# the short vowel-initial "is" and "a".
MEDIAN_TOL_SEC = 0.05
MAX_TOL_SEC = 0.2


@pytest.fixture(scope="module")
def clip(tmp_path_factory):
    if not shutil.which("say"):
        pytest.skip("needs macOS `say` to synthesise the clip")
    d = tmp_path_factory.mktemp("clip")
    audio, starts, t = [np.zeros(int(0.5 * SR))], [], 0.5
    for line in LINES:
        for word in line:
            f = d / f"{word}.wav"
            subprocess.run(["say", "-o", str(f), f"--data-format=LEI16@{SR}", word], check=True)
            x, _ = sf.read(f)
            loud = np.flatnonzero(np.abs(x) > 0.05 * np.abs(x).max())
            x = x[loud[0]:loud[-1] + 1]
            starts.append(t)
            audio += [x, np.zeros(int(0.35 * SR))]
            t += len(x) / SR + 0.35
        audio.append(np.zeros(SR))
        t += 1.0
    sf.write(d / "vocals.wav", np.concatenate(audio), SR)
    return d / "vocals.wav", starts


STABLE_TS_GAPS = pytest.mark.xfail(
    strict=True,
    reason="stable-ts starts a word where the previous one ended, so words after a pause come "
           "out 0.4-0.55 s early (vad and adjust_by_silence did not help)")


@pytest.mark.parametrize("aligner,module", [("whisperx", "whisperx"),
                                            pytest.param("stable-ts", "stable_whisper", marks=STABLE_TS_GAPS)])
def test_word_starts_match(clip, aligner, module):
    pytest.importorskip(module)
    path, starts = clip
    # Line times a few hundred ms off, as real LRC files are.
    first = [starts[0], starts[len(LINES[0])]]
    lines = [Line(" ".join(ws), s + off) for ws, s, off in zip(LINES, first, (0.3, -0.25))]
    words, auto = word_timings(path, lines, {**CFG, "aligner": aligner}, "cpu")
    assert not auto
    assert [w.text for w in words] == [x for ws in LINES for x in ws]
    errs = sorted(abs(w.start - s) for w, s in zip(words, starts))
    assert errs[len(errs) // 2] < MEDIAN_TOL_SEC and errs[-1] < MAX_TOL_SEC, [round(e, 3) for e in errs]
    assert all(w.score is not None for w in words)
