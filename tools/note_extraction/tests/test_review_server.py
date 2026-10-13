import json
import threading
import urllib.error
import urllib.request

import numpy as np
import pytest
import soundfile as sf

from note_extraction.notes import Note, load_notes, save_notes
from note_extraction.review_server import make_server


def test_review_server_roundtrip(tmp_path):
    out, site = tmp_path / "song", tmp_path / "site"
    out.mkdir()
    site.mkdir()
    meta = {
        "id": "t", "title": "T", "artist": "A", "site_offset_sec": 0.5, "tuning_cents": 0.0,
        "octave_fixes": 0, "tracker": "test", "lyrics_auto_generated": False, "reviewed": False,
        "backing_audio": None, "site_dir": str(site), "audio_file": "instrumental.mp3",
        "export": {"site_frame_rate": 50, "ultrastar_bpm": 1200},
    }
    save_notes(out / "notes.json", [
        Note(0.1, 0.3, 60, "la"), Note(0.3, 0.5, 62, "di", flags=["glide"]), Note(0.6, 0.9, 64, "da"),
    ], meta)
    sf.write(out / "vocals.wav", np.zeros(16000, dtype=np.float32), 16000)
    (out / "debug.json").write_text(json.dumps({"hop": 0.01, "midi": [60.0, None, float("nan")], "voiced": [1, 0, 0]}))

    httpd = make_server(out, 0)
    base = f"http://127.0.0.1:{httpd.server_address[1]}"
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    try:
        song = json.load(urllib.request.urlopen(base + "/api/song"))
        assert len(song["notes"]) == 3 and len(song["auto_notes"]) == 3
        assert song["sanity"] is None and song["audio"]["backing"] is None
        assert song["debug"]["midi"] == [60.0, None, None]
        assert "notes" not in song["meta"]
        assert urllib.request.urlopen(base + "/audio/vocals").read() == (out / "vocals.wav").read_bytes()
        with pytest.raises(urllib.error.HTTPError):
            urllib.request.urlopen(base + "/audio/backing")

        edited = song["notes"]
        edited[0]["midi"] = 61
        edited[0]["flags"] = ["edited"]
        req = urllib.request.Request(
            base + "/api/save", method="POST", headers={"Content-Type": "application/json"},
            data=json.dumps({"notes": edited, "global_offset_sec": 0.1}).encode(),
        )
        res = json.load(urllib.request.urlopen(req))
    finally:
        httpd.shutdown()
        httpd.server_close()

    assert res["ok"]
    for p in ("notes.json", "notes.auto.json", "melody.json", "song.txt"):
        assert str(out / p) in res["wrote"] and (out / p).exists()
    assert (site / "melody.json").exists()

    notes, saved_meta = load_notes(out / "notes.json")
    assert saved_meta["reviewed"] is True
    assert [n.start for n in notes] == pytest.approx([0.2, 0.4, 0.7])
    assert notes[0].midi == 61 and "edited" in notes[0].flags

    auto, _ = load_notes(out / "notes.auto.json")
    assert auto[0].midi == 60 and auto[0].start == pytest.approx(0.1)

    txt = (out / "song.txt").read_text()
    assert "#GAP:700" in txt  # (0.1 + 0.1 offset) + 0.5 site offset
    assert ": 0 16 1 la" in txt  # 0.2 s / 12.5 ms beats, pitch 61 - 60
