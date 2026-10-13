"""Stage 1: get a clean mono vocal (from a supplied stem, or Demucs on the mix)."""

from __future__ import annotations

import logging
import subprocess
import sys
from pathlib import Path

from .audio import clip_fraction, decode_to_wav, read_mono, rms_db

log = logging.getLogger(__name__)


def _demucs(mix: Path, out: Path, model: str, device: str) -> tuple[Path, Path]:
    cmd = [sys.executable, "-m", "demucs", "--two-stems=vocals", "-n", model, "-d", device,
           "-o", str(out), "--filename", "{stem}.{ext}", str(mix)]
    log.info("demucs %s on %s (%s)", model, mix.name, device)
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        tail = "\n".join(r.stderr.strip().splitlines()[-8:])
        raise RuntimeError(f"demucs failed on {device}:\n{tail}")
    return out / model / "vocals.wav", out / model / "no_vocals.wav"


def isolate(mix: Path | None, stem: Path | None, work: Path, cfg: dict, device: str) -> dict:
    """Writes work/vocals.wav (mono 16-bit) and, when separating, work/instrumental.wav."""
    sr = cfg["vocal_sr"]
    vocals = work / "vocals.wav"
    instrumental = None
    warnings: list[str] = []
    if stem is not None:
        decode_to_wav(stem, vocals, sr, 1)
    elif mix is not None:
        sep_dir = work / "demucs"
        try:
            v, nv = _demucs(Path(mix), sep_dir, cfg["model"], device)
        except RuntimeError as e:
            if device == "cpu":
                raise SystemExit(str(e)) from e
            log.warning("%s -- retrying on cpu", e)
            v, nv = _demucs(Path(mix), sep_dir, cfg["model"], "cpu")
        decode_to_wav(v, vocals, sr, 1)
        instrumental = decode_to_wav(nv, work / "instrumental.wav", 44100, 2)
    else:
        raise SystemExit("need a mix (song.mp3) or --stem vocals.wav")

    y, _ = read_mono(vocals)
    clip = clip_fraction(y)
    if clip >= cfg["clip_warn_fraction"]:
        warnings.append(f"vocal clips on {clip:.2%} of samples; expect octave/harmonic errors on loud notes")
    vdb = rms_db(y)
    if mix is not None:
        m, _ = read_mono(decode_to_wav(mix, work / "mix_mono.wav", 22050, 1))
        rel = vdb - rms_db(m)
        if rel < cfg["low_vocal_db"]:
            warnings.append(f"vocal is {rel:.0f} dB below the mix; separation found little voice")
    elif vdb < -45:
        warnings.append(f"vocal stem is very quiet ({vdb:.0f} dBFS)")
    for w in warnings:
        log.warning(w)
    return {"vocals": str(vocals), "instrumental": str(instrumental) if instrumental else None,
            "vocal_rms_db": round(vdb, 1), "clip_fraction": clip, "warnings": warnings}
