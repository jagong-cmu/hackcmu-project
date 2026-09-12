/**
 * Dev-only lyric tap-sync. Plays a pack's instrumental and records the moment
 * each line actually starts, so lyrics.lrc and melody.json can be re-anchored
 * to the real recording instead of an estimated tempo grid.
 *
 * The output JSON is fed back into scripts/build-song-packs.mjs.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { parseLrc } from "../lyrics/parseLrc.ts";
import { loadCatalog, loadSongPack, type ReadySong } from "../scoring/catalog.ts";

const PREROLL_SEC = 3;

export function SyncLyrics() {
  const [songs, setSongs] = useState<ReadySong[]>([]);
  const [songId, setSongId] = useState("");
  const [texts, setTexts] = useState<string[]>([]);
  const [audioUrl, setAudioUrl] = useState("");
  const [taps, setTaps] = useState<number[]>([]);
  const [playing, setPlaying] = useState(false);
  const [preroll, setPreroll] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [copied, setCopied] = useState(false);

  const audioRef = useRef<HTMLAudioElement>(null);
  const rafRef = useRef<number>(0);
  const prerollTimer = useRef<number>(0);

  useEffect(() => {
    void loadCatalog().then((list) => {
      setSongs(list);
      const first = list.find((s) => s.ready);
      if (first) setSongId(first.id);
    });
  }, []);

  useEffect(() => {
    if (!songId) return;
    let cancelled = false;
    void loadSongPack(songId).then((pack) => {
      if (cancelled) return;
      setTexts(parseLrc(pack.lrc).map((l) => l.text));
      setAudioUrl(pack.audioUrl);
      setTaps([]);
      setElapsed(0);
      setCopied(false);
    });
    return () => {
      cancelled = true;
    };
  }, [songId]);

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    window.clearInterval(prerollTimer.current);
    audioRef.current?.pause();
    setPlaying(false);
    setPreroll(0);
  }, []);

  useEffect(() => () => stop(), [stop]);

  function begin() {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;
    setTaps([]);
    setCopied(false);
    audio.src = audioUrl;
    audio.currentTime = 0;
    setPreroll(PREROLL_SEC);
    prerollTimer.current = window.setInterval(() => {
      setPreroll((p) => {
        if (p <= 1) {
          window.clearInterval(prerollTimer.current);
          void audio.play().then(() => {
            setPlaying(true);
            const tick = () => {
              setElapsed(audio.currentTime);
              if (audio.paused || audio.ended) {
                setPlaying(false);
                return;
              }
              rafRef.current = requestAnimationFrame(tick);
            };
            rafRef.current = requestAnimationFrame(tick);
          });
          return 0;
        }
        return p - 1;
      });
    }, 1000);
  }

  const tap = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !playing) return;
    setTaps((prev) => (prev.length >= texts.length ? prev : [...prev, audio.currentTime]));
  }, [playing, texts.length]);

  const undo = useCallback(() => {
    const audio = audioRef.current;
    setTaps((prev) => {
      if (!prev.length) return prev;
      const next = prev.slice(0, -1);
      if (audio) audio.currentTime = Math.max(0, prev[prev.length - 1] - 1.5);
      return next;
    });
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLSelectElement) return;
      if (e.code === "Space") {
        e.preventDefault();
        tap();
      } else if (e.code === "Backspace") {
        e.preventDefault();
        undo();
      } else if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        stop();
        begin();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tap, undo, stop, audioUrl]);

  const idx = taps.length;
  const done = idx >= texts.length && texts.length > 0;
  const output = JSON.stringify(
    { songId, lines: texts.map((text, i) => ({ text, tSec: taps[i] != null ? +taps[i].toFixed(2) : null })) },
    null,
    2,
  );

  return (
    <main className="page training">
      <header className="row-head">
        <Link to="/" className="back">
          Home
        </Link>
        <h1>Lyric sync</h1>
      </header>

      <label className="song-pick">
        Song
        <select value={songId} disabled={playing} onChange={(e) => { stop(); setSongId(e.target.value); }}>
          {songs.filter((s) => s.ready).map((s) => (
            <option key={s.id} value={s.id}>
              {s.title} — {s.artist}
            </option>
          ))}
        </select>
      </label>

      <p className="status">
        Space stamps the current line · Backspace undoes · R restarts
      </p>

      {preroll > 0 ? (
        <p className="status" style={{ fontSize: "3rem" }}>{preroll}</p>
      ) : null}

      <div style={{ minHeight: "9rem", margin: "1rem 0" }}>
        <p style={{ fontSize: "1.6rem", fontWeight: 600 }}>
          {done ? "All lines stamped." : texts[idx] ?? "—"}
        </p>
        <p style={{ opacity: 0.55 }}>{texts[idx + 1] ?? ""}</p>
        <p style={{ opacity: 0.3 }}>{texts[idx + 2] ?? ""}</p>
      </div>

      <p className="status">
        {elapsed.toFixed(2)}s · line {Math.min(idx + 1, texts.length)} of {texts.length}
      </p>

      <audio ref={audioRef} preload="auto" />

      <div className="ctas">
        <button type="button" className="btn gold" disabled={playing || preroll > 0 || !audioUrl} onClick={begin}>
          Start
        </button>
        <button type="button" className="btn ghost" disabled={!playing} onClick={tap}>
          Tap line
        </button>
        <button type="button" className="btn ghost" disabled={!playing && preroll === 0} onClick={stop}>
          Stop
        </button>
      </div>

      {taps.length > 0 ? (
        <>
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              void navigator.clipboard.writeText(output).then(() => setCopied(true));
            }}
          >
            {copied ? "Copied" : "Copy JSON"}
          </button>
          <pre style={{ maxHeight: "16rem", overflow: "auto", fontSize: "0.8rem", textAlign: "left" }}>{output}</pre>
        </>
      ) : null}
    </main>
  );
}
