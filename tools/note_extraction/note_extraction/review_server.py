"""Local review UI for one song's out/<id>/ dir: piano roll + audio, edit notes, save + re-export.

Run: .venv/bin/python -m note_extraction.review_server out/<id> [port]
"""

from __future__ import annotations

import json
import mimetypes
import shutil
import sys
import webbrowser
from dataclasses import asdict, fields
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from .notes import Note, load_notes, save_notes
from .pipeline import write_outputs

INDEX = Path(__file__).resolve().parent.parent / "review" / "index.html"
NOTE_FIELDS = {f.name for f in fields(Note)}
MIN_DUR = 0.01


def _read_json(path: Path):
    return json.loads(path.read_text()) if path.exists() else None


def audio_paths(out_dir: Path, meta: dict) -> tuple[Path, Path | None, bool]:
    """(vocals, backing or None, backing_on_site_timeline)."""
    backing = meta.get("backing_audio")
    if backing and Path(backing).is_file():
        return out_dir / "vocals.wav", Path(backing), True
    inst = out_dir / "instrumental.wav"
    return out_dir / "vocals.wav", (inst if inst.is_file() else None), False


def song_payload(out_dir: Path) -> dict:
    notes, meta = load_notes(out_dir / "notes.json")
    auto_path = out_dir / "notes.auto.json"
    auto = load_notes(auto_path)[0] if auto_path.exists() else notes
    debug = _read_json(out_dir / "debug.json")
    if debug:
        # debug.json may hold NaN, which JSON.parse rejects.
        midi = [None if m is None or m != m else m for m in debug.get("midi", [])]
        debug = {"hop": debug["hop"], "midi": midi, "voiced": debug.get("voiced", [])}
    _, backing, on_site = audio_paths(out_dir, meta)
    return {
        "meta": meta,
        "notes": [asdict(n) for n in notes],
        "auto_notes": [asdict(n) for n in auto],
        "debug": debug,
        "sanity": _read_json(out_dir / "sanity.json"),
        "audio": {
            "vocals": "/audio/vocals",
            "backing": "/audio/backing" if backing else None,
            "backing_on_site_timeline": on_site,
        },
    }


def save(out_dir: Path, body: dict) -> list[str]:
    """Bake global_offset_sec into the notes, write notes.json and re-export. Returns paths written."""
    offset = float(body.get("global_offset_sec", 0))
    notes = [Note(**{k: v for k, v in n.items() if k in NOTE_FIELDS}) for n in body["notes"]]
    if not notes:
        raise ValueError("no notes")
    for n in notes:
        n.start, n.end = round(n.start + offset, 4), round(n.end + offset, 4)
        if n.start < 0 or n.end - n.start < MIN_DUR - 1e-6:
            raise ValueError(f"bad note {n.start:.3f}-{n.end:.3f} after offset")
    notes.sort(key=lambda n: n.start)

    notes_path, auto_path = out_dir / "notes.json", out_dir / "notes.auto.json"
    _, meta = load_notes(notes_path)
    meta["reviewed"] = True

    wrote = []
    if not auto_path.exists():
        shutil.copyfile(notes_path, auto_path)
        wrote.append(auto_path)
    save_notes(notes_path, notes, meta)
    wrote.append(notes_path)
    wrote += write_outputs(out_dir, notes, meta)
    return [str(p) for p in wrote]


def make_server(out_dir: Path, port: int = 8765) -> ThreadingHTTPServer:
    out_dir = Path(out_dir).resolve()

    class Handler(BaseHTTPRequestHandler):
        def _send(self, code: int, body: bytes, ctype: str) -> None:
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _json(self, code: int, obj) -> None:
            self._send(code, json.dumps(obj, ensure_ascii=False).encode(), "application/json")

        def do_GET(self):
            path = self.path.split("?")[0]
            if path == "/":
                return self._send(200, INDEX.read_bytes(), "text/html; charset=utf-8")
            if path == "/api/song":
                return self._json(200, song_payload(out_dir))
            if path in ("/audio/vocals", "/audio/backing"):
                vocals, backing, _ = audio_paths(out_dir, load_notes(out_dir / "notes.json")[1])
                f = vocals if path == "/audio/vocals" else backing
                if f and f.is_file():
                    ctype = mimetypes.guess_type(f.name)[0] or "application/octet-stream"
                    return self._send(200, f.read_bytes(), ctype)
            self._json(404, {"error": "not found"})

        def do_POST(self):
            if self.path != "/api/save":
                return self._json(404, {"error": "not found"})
            # JSON content type forces a CORS preflight, so other sites can't post here.
            if self.headers.get("Content-Type") != "application/json":
                return self._json(415, {"ok": False, "error": "expected application/json"})
            try:
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                self._json(200, {"ok": True, "wrote": save(out_dir, body)})
            except (ValueError, KeyError, TypeError) as e:
                self._json(400, {"ok": False, "error": str(e)})

    return ThreadingHTTPServer(("127.0.0.1", port), Handler)


def serve(out_dir: Path, port: int = 8765, open_browser: bool = True) -> None:
    httpd = make_server(out_dir, port)
    url = f"http://127.0.0.1:{httpd.server_address[1]}/"
    print(f"review: {url}  (Ctrl+C to stop)")
    if open_browser:
        webbrowser.open(url)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == "__main__":
    serve(Path(sys.argv[1]), *map(int, sys.argv[2:3]))
