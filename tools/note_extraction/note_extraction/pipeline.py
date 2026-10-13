"""Runs the stages for one song, caching each stage's output in work/<id>/.

A stage re-runs only when its cache key changes. The key hashes the stage's
inputs, its config section and the upstream stage's key, so editing a
segmentation threshold re-runs segmentation, lyrics and export, but not Demucs
or pitch tracking.
"""

from __future__ import annotations

import hashlib
import json
import logging
import shutil
import time
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from . import export, lyrics, pitch, sanity, segment, separate, tuning
from .notes import Note, load_notes, save_notes

log = logging.getLogger(__name__)
TOOL_ROOT = Path(__file__).resolve().parents[1]
# Bump when a stage's code changes in a way that should invalidate old caches.
CODE_VERSION = {"isolate": 1, "pitch": 2, "curve": 2, "segment": 2, "lyrics": 1}


@dataclass
class Job:
    id: str
    out: Path
    mix: Path | None = None
    stem: Path | None = None
    lyrics: Path | None = None
    title: str = ""
    artist: str = ""
    # site time = source time + site_offset_sec. Source = the stem's timeline when a
    # stem is given, else the mix's.
    site_offset_sec: float = 0.0
    # LRC time = source time + lrc_offset_sec. Defaults to site_offset_sec, because
    # the site's own lyrics.lrc files are timed to the karaoke track.
    lrc_offset_sec: float | None = None
    site_dir: Path | None = None  # also write melody.json here
    backing: Path | None = None  # the site's karaoke track, for the review tool
    work: Path | None = None
    timings: dict = field(default_factory=dict)


def _fp(path: Path | None) -> str | None:
    if path is None:
        return None
    st = Path(path).stat()
    return f"{Path(path).resolve()}:{st.st_size}:{int(st.st_mtime)}"


def _key(*parts) -> str:
    return hashlib.sha1(json.dumps(parts, sort_keys=True, default=str).encode()).hexdigest()[:16]


def _stage(job: Job, name: str, key: str, outputs: list[Path], fn, force: bool):
    rec = job.work / f"{name}.stage.json"
    if not force and rec.exists() and all(p.exists() for p in outputs):
        saved = json.loads(rec.read_text())
        if saved["key"] == key:
            log.info("[%s] cached", name)
            job.timings[name] = 0.0
            return saved["result"]
    t = time.perf_counter()
    result = fn()
    dt = time.perf_counter() - t
    job.timings[name] = round(dt, 2)
    rec.write_text(json.dumps({"key": key, "result": result}, default=str))
    log.info("[%s] done in %.1fs", name, dt)
    return result


def run(job: Job, cfg: dict, device: str, force: bool = False) -> dict:
    job.work = job.work or TOOL_ROOT / "work" / job.id
    job.work.mkdir(parents=True, exist_ok=True)
    job.out.mkdir(parents=True, exist_ok=True)
    if job.lrc_offset_sec is None:
        job.lrc_offset_sec = job.site_offset_sec
    w = job.work

    # Stage 1 ---------------------------------------------------------------
    k1 = _key("isolate", CODE_VERSION["isolate"], _fp(job.mix), _fp(job.stem), cfg["separation"])
    iso = _stage(job, "isolate", k1, [w / "vocals.wav"],
                 lambda: separate.isolate(job.mix, job.stem, w, cfg["separation"], device), force)

    # Stage 2 ---------------------------------------------------------------
    pcfg = cfg["pitch"]
    k2 = _key("pitch", CODE_VERSION["pitch"], k1, {k: pcfg[k] for k in ("tracker", "hop_sec", "fmin_hz", "fmax_hz")})

    def do_pitch():
        r = pitch.track(Path(iso["vocals"]), pcfg, device)
        np.savez_compressed(w / "pitch.npz", f0=r["f0"], confidence=r["confidence"], energy_db=r["energy_db"])
        if r["bleed_share"] is not None and r["bleed_share"] >= cfg["separation"]["bleed_warn_fraction"]:
            log.warning("backing-vocal bleed on %.0f%% of voiced frames", 100 * r["bleed_share"])
        return {"hop": r["hop"], "frames": len(r["f0"]), "bleed_share": r["bleed_share"]}

    pr = _stage(job, "pitch", k2, [w / "pitch.npz"], do_pitch, force)

    # Stage 2b + 3: octave repair, tuning -----------------------------------
    k3 = _key("curve", CODE_VERSION["curve"], k2, pcfg, cfg["tuning"])

    def do_curve():
        z = np.load(w / "pitch.npz")
        f0, conf = z["f0"], z["confidence"]
        hop = pr["hop"]
        voiced = pitch.voiced_mask(f0, conf, pcfg)
        midi, fixed = pitch.fix_octaves(pitch.midi_from_hz(f0), voiced, hop, pcfg)
        log.info("octave repair: %d frames corrected", fixed)
        cents = tuning.estimate_offset_cents(midi, voiced & (conf >= cfg["tuning"]["min_confidence"]))
        review = abs(cents) > cfg["tuning"]["review_cents"]
        (log.warning if review else log.info)("tuning offset %+.1f cents%s", cents, " -- REVIEW" if review else "")
        midi = tuning.apply_offset(midi, cents)
        np.savez_compressed(w / "curve.npz", midi=np.where(voiced, midi, np.nan), voiced=voiced, confidence=conf,
                            energy_db=z["energy_db"])
        return {"octave_fixes": fixed, "tuning_cents": cents, "tuning_review": bool(review)}

    cv = _stage(job, "curve", k3, [w / "curve.npz"], do_curve, force)
    z = np.load(w / "curve.npz")
    curve = {"midi": z["midi"], "voiced": z["voiced"], "confidence": z["confidence"], "energy_db": z["energy_db"],
             "hop": pr["hop"]}

    # Stage 4 ---------------------------------------------------------------
    k4 = _key("segment", CODE_VERSION["segment"], k3, cfg["segmentation"])

    def do_segment():
        notes = segment.segment(curve["midi"], curve["voiced"], curve["hop"], cfg["segmentation"], curve["energy_db"])
        save_notes(w / "notes.segment.json", notes, {})
        return {"notes": len(notes), "glide_notes": sum("glide" in n.flags for n in notes)}

    _stage(job, "segment", k4, [w / "notes.segment.json"], do_segment, force)
    notes, _ = load_notes(w / "notes.segment.json")

    # Stage 5 ---------------------------------------------------------------
    k5 = _key("lyrics", CODE_VERSION["lyrics"], k4, cfg["lyrics"], _fp(job.lyrics), job.lrc_offset_sec)

    def do_lyrics():
        out, info = lyrics.align_lyrics(notes, Path(iso["vocals"]), job.lyrics, job.lrc_offset_sec,
                                        cfg["lyrics"], device)
        save_notes(w / "notes.lyrics.json", out, {})
        (w / "lyrics.json").write_text(json.dumps(info, ensure_ascii=False))
        return {"auto": info["lyrics_auto_generated"], "unplaced": len(info["unplaced_syllables"])}

    _stage(job, "lyrics", k5, [w / "notes.lyrics.json", w / "lyrics.json"], do_lyrics, force)
    notes, _ = load_notes(w / "notes.lyrics.json")
    lyr = json.loads((w / "lyrics.json").read_text())

    # Stage 6: export (cheap, always runs) -----------------------------------
    t = time.perf_counter()
    meta = {
        "id": job.id, "title": job.title, "artist": job.artist,
        "site_offset_sec": job.site_offset_sec,
        "tuning_cents": cv["tuning_cents"], "octave_fixes": cv["octave_fixes"],
        "tracker": pcfg["tracker"], "lyrics_auto_generated": lyr["lyrics_auto_generated"],
        "reviewed": False,
        "backing_audio": str(Path(job.backing).resolve()) if job.backing else None,
        "site_dir": str(Path(job.site_dir).resolve()) if job.site_dir else None,
        "audio_file": "instrumental.mp3",
        "export": dict(cfg["export"]),
    }
    out = job.out
    save_notes(out / "notes.auto.json", notes, meta)
    current = out / "notes.json"
    if current.exists() and load_notes(current)[1].get("reviewed") and not force:
        log.warning("%s was hand-reviewed; keeping it (notes.auto.json updated). --force to replace.", current)
        notes, meta = load_notes(current)
    else:
        save_notes(current, notes, meta)
    write_outputs(out, notes, meta)

    rep = sanity.report(notes, curve, {**cv, "bleed_share": pr["bleed_share"], "warnings": iso["warnings"],
                                       "lyrics": lyr}, cfg["sanity"])
    export.write_json(out / "sanity.json", rep)
    (out / "sanity.md").write_text(sanity.to_markdown(rep, job.title or job.id, job.site_offset_sec))
    export.write_json(out / "debug.json", {
        "hop": curve["hop"],
        "f0_hz": np.round(np.load(w / "pitch.npz")["f0"], 2).tolist(),
        "confidence": np.round(curve["confidence"], 3).tolist(),
        "voiced": curve["voiced"].astype(int).tolist(),
        "midi": [None if np.isnan(v) else round(float(v), 3) for v in curve["midi"]],
        "tuning_cents": cv["tuning_cents"], "octave_fixes": cv["octave_fixes"],
        "params": cfg,
        "inputs": {"mix": str(job.mix) if job.mix else None, "stem": str(job.stem) if job.stem else None,
                   "lyrics": str(job.lyrics) if job.lyrics else None,
                   "site_offset_sec": job.site_offset_sec, "lrc_offset_sec": job.lrc_offset_sec},
    })
    for name in ("vocals.wav", "instrumental.wav"):
        if (w / name).exists():
            shutil.copyfile(w / name, out / name)
    job.timings["export"] = round(time.perf_counter() - t, 2)
    (w / "last_run.json").write_text(json.dumps({"timings": job.timings}))
    return {"notes": len(notes), "summary": rep["summary"], "timings": job.timings}


def write_outputs(out: Path, notes: list[Note], meta: dict) -> list[Path]:
    """melody.json (site), song.txt (UltraStar), and the site copy. Also used by the review tool."""
    ex = meta["export"]
    melody = export.to_site_melody(notes, meta["site_offset_sec"], ex["site_frame_rate"])
    written = [out / "melody.json", out / "song.txt"]
    export.write_json(out / "melody.json", melody)
    (out / "song.txt").write_text(export.to_ultrastar(notes, meta, meta["site_offset_sec"], ex["ultrastar_bpm"]),
                                  encoding="utf-8")
    if meta.get("site_dir"):
        site = Path(meta["site_dir"]) / "melody.json"
        export.write_json(site, melody)
        written.append(site)
    return written
