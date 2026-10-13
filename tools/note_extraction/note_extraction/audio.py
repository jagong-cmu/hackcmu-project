"""ffmpeg decoding and the level checks Stage 1 warns on."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import numpy as np


def require_ffmpeg() -> None:
    if not shutil.which("ffmpeg"):
        raise SystemExit("ffmpeg not found on PATH. Install it (macOS: brew install ffmpeg).")


def decode_to_wav(src: Path, dst: Path, sr: int, channels: int = 1) -> Path:
    """Any ffmpeg-readable file -> 16-bit PCM WAV."""
    require_ffmpeg()
    if not Path(src).exists():
        raise SystemExit(f"input not found: {src}")
    cmd = ["ffmpeg", "-v", "error", "-y", "-i", str(src), "-ac", str(channels), "-ar", str(sr),
           "-sample_fmt", "s16", str(dst)]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f"ffmpeg could not decode {src}:\n{r.stderr.strip()}")
    return Path(dst)


def read_mono(path: Path) -> tuple[np.ndarray, int]:
    import soundfile as sf

    y, sr = sf.read(str(path), dtype="float32", always_2d=True)
    return y.mean(axis=1), sr


def rms_db(y: np.ndarray) -> float:
    return float(20 * np.log10(np.sqrt(np.mean(np.square(y, dtype=np.float64))) + 1e-12))


def clip_fraction(y: np.ndarray) -> float:
    return float(np.mean(np.abs(y) >= 0.999))
