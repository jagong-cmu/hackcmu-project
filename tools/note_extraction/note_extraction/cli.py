"""Command line: extract, batch, align, evaluate, review."""

from __future__ import annotations

import argparse
import json
import logging
import shutil
import sys
from pathlib import Path

import yaml

from .pipeline import TOOL_ROOT, Job, run

AUDIO = (".mp3", ".wav", ".flac", ".m4a", ".ogg")
log = logging.getLogger("note_extraction")


def load_config(path: str | None, tracker: str | None, aligner: str | None = None) -> dict:
    p = Path(path) if path else TOOL_ROOT / "config.yaml"
    if not p.exists():
        raise SystemExit(f"config not found: {p}")
    cfg = yaml.safe_load(p.read_text())
    if tracker:
        cfg["pitch"]["tracker"] = tracker
    if aligner:
        cfg["lyrics"]["aligner"] = aligner
    return cfg


def _common(p: argparse.ArgumentParser) -> None:
    p.add_argument("--config", help="config.yaml to use (default: the one next to this tool)")
    p.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda", "mps"])
    p.add_argument("--tracker", choices=["rmvpe", "crepe", "pyin"], help="overrides config pitch.tracker")
    p.add_argument("--aligner", choices=["whisperx", "stable-ts"], help="overrides config lyrics.aligner")
    p.add_argument("--force", action="store_true", help="re-run every stage and overwrite reviewed notes")
    p.add_argument("-q", "--quiet", action="store_true")


def _run_job(job: Job, args) -> dict:
    from .pitch import resolve_device

    cfg = load_config(args.config, args.tracker, args.aligner)
    device = resolve_device(args.device)
    log.info("== %s (%s, tracker %s)", job.id, device, cfg["pitch"]["tracker"])
    res = run(job, cfg, device, force=args.force)
    s = res["summary"]
    t = res["timings"]
    log.info("== %s: %d notes, voiced %.0f%%, tuning %+.0f c, %s octave fixes | %s | total %.1fs",
             job.id, res["notes"], 100 * s["voiced_fraction"], s["tuning_cents"], s["octave_fixes"],
             " ".join(f"{k} {v:.1f}s" for k, v in t.items()), sum(t.values()))
    for w in s["warnings"]:
        log.warning("%s: %s", job.id, w)
    return res


def _path(v) -> Path | None:
    return Path(v).expanduser() if v else None


def cmd_extract(args) -> None:
    if not args.mix and not args.stem:
        raise SystemExit("give a mix (song.mp3) or --stem vocals.wav")
    out = Path(args.out)
    job = Job(id=args.id or out.name, out=out, mix=_path(args.mix), stem=_path(args.stem),
              lyrics=_path(args.lyrics), title=args.title or "", artist=args.artist or "",
              site_offset_sec=args.site_offset, lrc_offset_sec=args.lrc_offset,
              site_dir=_path(args.site_dir), backing=_path(args.backing))
    _run_job(job, args)


def _jobs_from_manifest(path: Path, out_root: Path) -> list[Job]:
    spec = yaml.safe_load(path.read_text())
    base = path.parent

    def rel(v):
        return (base / v).resolve() if v else None

    return [Job(id=s["id"], out=out_root / s["id"], mix=rel(s.get("mix")), stem=rel(s.get("stem")),
                lyrics=rel(s.get("lyrics")), title=s.get("title", ""), artist=s.get("artist", ""),
                site_offset_sec=float(s.get("site_offset_sec", 0)), lrc_offset_sec=s.get("lrc_offset_sec"),
                site_dir=rel(s.get("site_dir")), backing=rel(s.get("backing")))
            for s in spec["songs"]]


def _jobs_from_dir(root: Path, out_root: Path) -> list[Job]:
    """One sub-directory per song: a mix (any audio), optionally vocals.* (stem),
    lyrics.txt|lrc, and song.yaml with title/artist/site_offset_sec/... overrides."""
    jobs = []
    for d in sorted(p for p in root.iterdir() if p.is_dir()):
        audio = [f for f in d.iterdir() if f.suffix.lower() in AUDIO]
        stem = next((f for f in audio if f.stem.lower().startswith(("vocals", "stem", "acapella"))), None)
        mix = next((f for f in audio if f is not stem and not f.stem.lower().startswith("instrumental")), None)
        lyr = next((d / n for n in ("lyrics.lrc", "lyrics.txt") if (d / n).exists()), None)
        meta = yaml.safe_load((d / "song.yaml").read_text()) if (d / "song.yaml").exists() else {}
        if not mix and not stem:
            log.warning("skipping %s: no audio", d)
            continue
        jobs.append(Job(id=d.name, out=out_root / d.name, mix=mix, stem=stem, lyrics=lyr,
                        title=meta.get("title", d.name), artist=meta.get("artist", ""),
                        site_offset_sec=float(meta.get("site_offset_sec", 0)),
                        lrc_offset_sec=meta.get("lrc_offset_sec"), site_dir=_path(meta.get("site_dir")),
                        backing=_path(meta.get("backing"))))
    return jobs


def _jobs(args) -> list[Job]:
    src, out_root = Path(args.input), Path(args.out)
    if not src.exists():
        raise SystemExit(f"not found: {src}")
    jobs = _jobs_from_manifest(src, out_root) if src.suffix in (".yaml", ".yml") else _jobs_from_dir(src, out_root)
    return [j for j in jobs if j.id in args.only] if args.only else jobs


def cmd_batch(args) -> None:
    jobs = _jobs(args)
    failed = []
    for i, job in enumerate(jobs, 1):
        if (job.out / "melody.json").exists() and not args.force and not args.rerun:
            log.info("[%d/%d] %s: outputs exist, skipping (--rerun to refresh from cache, --force to redo)",
                     i, len(jobs), job.id)
            continue
        log.info("[%d/%d] %s", i, len(jobs), job.id)
        try:
            _run_job(job, args)
        except SystemExit as e:
            log.error("%s failed: %s", job.id, e)
            failed.append(job.id)
    if failed:
        raise SystemExit(f"failed: {', '.join(failed)}")


def cmd_align(args) -> None:
    """Re-align every song and put its words.json on the site. Cached stages stay cached,
    so this re-runs only the aligner (when its config or code changed) and the export."""
    site_root = Path(args.site_root)
    failed, flagged = [], {}
    for i, job in enumerate(_jobs(args), 1):
        log.info("[%d] %s", i, job.id)
        try:
            flagged[job.id] = _run_job(job, args)["flagged_words"]
        except SystemExit as e:
            log.error("%s failed: %s", job.id, e)
            failed.append(job.id)
            continue
        if (site_root / job.id).is_dir():
            shutil.copyfile(job.out / "words.json", site_root / job.id / "words.json")
            log.info("%s: wrote %s", job.id, site_root / job.id / "words.json")
    for sid, ws in flagged.items():
        print(f"\n{sid}: {len(ws)} flagged word(s) (see {Path(args.out) / sid / 'align_report.md'})")
        for w in ws:
            score = "-" if w["score"] is None else f"{w['score']:.2f}"
            print(f"  {w['start']:8.2f}s  {w['text']:<14} score {score:<5} {', '.join(w['flags'])}  | {w['line']}")
    if failed:
        raise SystemExit(f"failed: {', '.join(failed)}")


def cmd_evaluate(args) -> None:
    from .evaluate import evaluate_pair, table, worst_text

    if len(args.pred) != len(args.ref):
        raise SystemExit("give one --ref per --pred")
    names = args.name or [Path(p).stem if Path(p).is_file() else Path(p).name for p in args.pred]
    rows = [evaluate_pair(Path(p), Path(r), args.max_lag) for p, r in zip(args.pred, args.ref)]
    print(table(rows, names))
    print(worst_text(rows, names))
    if args.json:
        Path(args.json).write_text(json.dumps(dict(zip(names, rows)), indent=1))


def cmd_benchmark(args) -> None:
    from .benchmark import run_benchmark
    from .pitch import resolve_device

    print(run_benchmark(load_config(args.config, args.tracker, args.aligner), resolve_device(args.device), sweep=args.sweep))


def cmd_review(args) -> None:
    from .review_server import serve

    serve(Path(args.out_dir), port=args.port, open_browser=not args.no_browser)


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(prog="ne", description="Vocal note extraction for the karaoke site.")
    sub = ap.add_subparsers(dest="cmd", required=True)

    e = sub.add_parser("extract", help="one song")
    e.add_argument("mix", nargs="?", help="full mix (mp3/wav/flac); separated with Demucs unless --stem")
    e.add_argument("--stem", help="isolated vocal; skips separation")
    e.add_argument("--lyrics", help="lyrics .txt (one line per line) or .lrc")
    e.add_argument("--out", required=True, help="output directory for this song")
    e.add_argument("--id", help="song id (default: output directory name)")
    e.add_argument("--title")
    e.add_argument("--artist")
    e.add_argument("--site-offset", type=float, default=0.0,
                   help="seconds: site/backing-track time = source time + this")
    e.add_argument("--lrc-offset", type=float, help="seconds: LRC time = source time + this (default: --site-offset)")
    e.add_argument("--site-dir", help="also write melody.json into this site song folder")
    e.add_argument("--backing", help="the site's backing track, for the review tool")
    _common(e)
    e.set_defaults(fn=cmd_extract)

    b = sub.add_parser("batch", help="many songs from a directory or a manifest .yaml")
    b.add_argument("input")
    b.add_argument("--out", required=True)
    b.add_argument("--only", nargs="*", help="song ids to run")
    b.add_argument("--rerun", action="store_true", help="run songs whose outputs exist (cached stages stay cached)")
    _common(b)
    b.set_defaults(fn=cmd_batch)

    a = sub.add_parser("align", help="re-align every song's lyrics and write words.json into the site")
    a.add_argument("input", help="manifest .yaml or a folder of songs (as for batch)")
    a.add_argument("--out", required=True)
    a.add_argument("--only", nargs="*", help="song ids to run")
    a.add_argument("--site-root", default=str(TOOL_ROOT.parents[1] / "apps" / "web" / "public" / "songs"),
                   help="site songs folder; words.json goes to <site-root>/<id>/ when that folder exists")
    _common(a)
    a.set_defaults(fn=cmd_align)

    v = sub.add_parser("evaluate", help="compare with reference note files")
    v.add_argument("--pred", action="append", required=True, help="output dir, melody.json or UltraStar .txt")
    v.add_argument("--ref", action="append", required=True, help="reference melody.json or UltraStar .txt")
    v.add_argument("--name", action="append")
    v.add_argument("--max-lag", type=float, default=10.0, help="largest global offset to search (s)")
    v.add_argument("--json", help="write full results here")
    v.set_defaults(fn=cmd_evaluate)

    k = sub.add_parser("benchmark", help="score stages 2-4 on synthetic singing with known notes")
    k.add_argument("--sweep", action="store_true", help="vary each segmentation threshold")
    _common(k)
    k.set_defaults(fn=cmd_benchmark)

    r = sub.add_parser("review", help="open the review tool for one output directory")
    r.add_argument("out_dir")
    r.add_argument("--port", type=int, default=8765)
    r.add_argument("--no-browser", action="store_true")
    r.set_defaults(fn=cmd_review)

    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.WARNING if getattr(args, "quiet", False) else logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S", stream=sys.stderr)
    for noisy in ("numba", "matplotlib", "urllib3", "speechbrain", "pytorch_lightning", "lightning", "whisperx"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    args.fn(args)
