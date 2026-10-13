"""Stage 2: vocal WAV -> frame-level f0 curve (10 ms hop), plus octave-error repair."""

from __future__ import annotations

import logging
import urllib.request
from pathlib import Path

import numpy as np

log = logging.getLogger(__name__)

MODELS_DIR = Path(__file__).resolve().parents[1] / "models"
RMVPE_URL = "https://huggingface.co/lj1995/VoiceConversionWebUI/resolve/main/rmvpe.pt"
SR = 16000


def resolve_device(name: str) -> str:
    import torch

    if name == "auto":
        if torch.cuda.is_available():
            return "cuda"
        if torch.backends.mps.is_available():
            return "mps"
        return "cpu"
    if name == "cuda" and not torch.cuda.is_available():
        raise SystemExit("--device cuda: no CUDA GPU found. Use --device auto, mps or cpu.")
    if name == "mps" and not torch.backends.mps.is_available():
        raise SystemExit("--device mps: Metal is not available here. Use --device auto or cpu.")
    return name


def _rmvpe_weights() -> Path:
    path = MODELS_DIR / "rmvpe.pt"
    if path.exists():
        return path
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    log.info("downloading RMVPE weights (~180 MB) to %s", path)
    tmp = path.with_suffix(".part")
    try:
        urllib.request.urlretrieve(RMVPE_URL, tmp)
    except Exception as e:  # network, 404, disk
        raise SystemExit(
            f"Could not download RMVPE weights from {RMVPE_URL}: {e}\n"
            f"Download rmvpe.pt by hand into {MODELS_DIR}, or use --tracker crepe / pyin."
        ) from e
    tmp.rename(path)
    return path


def _load16k(path: Path) -> np.ndarray:
    import librosa

    y, _ = librosa.load(str(path), sr=SR, mono=True)
    return y.astype(np.float32)


def track(vocal_wav: Path, cfg: dict, device: str) -> dict:
    """Returns f0 (Hz, 0 = none), confidence (0..1), salience-derived bleed share, hop."""
    tracker, hop = cfg["tracker"], cfg["hop_sec"]
    y = _load16k(vocal_wav)
    bleed = None
    if tracker == "rmvpe":
        from ._rmvpe import Rmvpe

        try:
            model = Rmvpe(str(_rmvpe_weights()), device)
            sal = model.salience(y)
        except (RuntimeError, NotImplementedError) as e:
            if device == "cpu":
                raise
            log.warning("RMVPE failed on %s (%s); retrying on cpu", device, e)
            model = Rmvpe(str(_rmvpe_weights()), "cpu")
            sal = model.salience(y)
        f0, conf = model.decode(sal, threshold=0.0)
        bleed = _competing_pitch_share(sal, conf >= cfg["voiced_confidence"]["rmvpe"])
    elif tracker == "crepe":
        import torch
        import torchcrepe

        x = torch.from_numpy(y).unsqueeze(0)
        f0, per = torchcrepe.predict(
            x, SR, hop_length=int(SR * hop), fmin=cfg["fmin_hz"], fmax=cfg["fmax_hz"],
            model="full", return_periodicity=True, batch_size=512, device=device,
        )
        f0, conf = f0.squeeze(0).cpu().numpy(), per.squeeze(0).cpu().numpy()
    elif tracker == "pyin":
        import librosa

        f0, _, conf = librosa.pyin(
            y, fmin=cfg["fmin_hz"], fmax=cfg["fmax_hz"], sr=SR,
            frame_length=1024, hop_length=int(SR * hop),
        )
        f0 = np.nan_to_num(f0)
    else:
        raise SystemExit(f"unknown tracker {tracker!r}; use rmvpe, crepe or pyin")
    f0 = np.asarray(f0, dtype=float)
    conf = np.nan_to_num(np.asarray(conf, dtype=float))
    return {"f0": f0, "confidence": conf, "hop": hop, "bleed_share": bleed,
            "energy_db": energy_db(y, hop, len(f0))}


def energy_db(y16k: np.ndarray, hop: float, frames: int) -> np.ndarray:
    """25 ms RMS in dB on the same 10 ms centred grid as the trackers. Consonants
    show up as short dips here even when the pitch tracker's longer window
    bridges them."""
    import librosa

    rms = librosa.feature.rms(y=y16k, frame_length=400, hop_length=int(SR * hop), center=True)[0]
    db = 20 * np.log10(np.maximum(rms, 1e-6))
    return np.pad(db, (0, max(0, frames - len(db))), constant_values=-120)[:frames]


def _competing_pitch_share(sal: np.ndarray, voiced: np.ndarray) -> float:
    """Share of voiced frames whose salience has a strong second peak that is not
    the main pitch or its octave: a backing vocal or harmony under the lead."""
    if not voiced.any():
        return 0.0
    s = sal[voiced].copy()
    main = s.argmax(1)
    top = s[np.arange(len(s)), main]
    bins = np.arange(s.shape[1])[None, :]
    for centre in (main, main + 60, main - 60):  # 60 bins = 12 semitones
        s[np.abs(bins - centre[:, None]) <= 5] = 0
    return float(((s.max(1) >= 0.5 * top) & (s.max(1) >= 0.1)).mean())


def voiced_mask(f0: np.ndarray, conf: np.ndarray, cfg: dict) -> np.ndarray:
    thr = cfg["voiced_confidence"][cfg["tracker"]]
    return (conf >= thr) & (f0 >= cfg["fmin_hz"]) & (f0 <= cfg["fmax_hz"])


def midi_from_hz(f0: np.ndarray) -> np.ndarray:
    with np.errstate(divide="ignore", invalid="ignore"):
        return np.where(f0 > 0, 69 + 12 * np.log2(np.maximum(f0, 1e-9) / 440), np.nan)


def fix_octaves(midi: np.ndarray, voiced: np.ndarray, hop: float, cfg: dict) -> tuple[np.ndarray, int]:
    """Snap single frames (or short flecks) that sit an octave off agreeing neighbours.

    Decisions read the unrepaired curve, so one repair cannot cascade into the
    next. A long passage an octave up is its own neighbourhood and is left alone,
    so a real octave leap survives.
    """
    half = max(1, int(round(cfg["octave_window_sec"] / 2 / hop)))
    tol, mad_max = cfg["octave_tolerance_st"], cfg["octave_neighbour_mad_st"]
    out = midi.copy()
    fixed = 0
    for i in np.flatnonzero(voiced):
        lo, hi = max(0, i - half), min(len(midi), i + half + 1)
        nb = np.concatenate([midi[lo:i][voiced[lo:i]], midi[i + 1 : hi][voiced[i + 1 : hi]]])
        if nb.size < 4:
            continue
        med = float(np.median(nb))
        if float(np.median(np.abs(nb - med))) > mad_max:
            continue
        d = midi[i] - med
        for k in (12, -12, 24, -24):
            if abs(d - k) <= tol:
                out[i] = midi[i] - k
                fixed += 1
                break
    return out, fixed
