import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Light } from "./Light.tsx";
import { nextLikelyRoom, roomImages, type RoomId } from "./rooms.ts";
import { useScene } from "./SceneProvider.tsx";
import "./scene.css";

/** Preload only the next likely room, and only its AVIF (desktop Chrome decodes it). */
const warmed = new Set<RoomId>();
function warm(room: RoomId): void {
  if (warmed.has(room)) return;
  warmed.add(room);
  const img = new Image();
  img.decoding = "async";
  img.src = roomImages(room).avif;
}

/**
 * One room: an instant blurred placeholder, the full image fading in over it,
 * and the solid maroon-black ground underneath if either is missing. A missing
 * or failed image never breaks a page; it just leaves the solid fallback.
 */
function RoomLayer({ room, crossfade }: { room: RoomId; crossfade: boolean }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const src = roomImages(room);
  return (
    <div className={`room-layer${crossfade ? " is-crossfading" : ""}`} data-room={room}>
      <div className="room-blur" style={{ backgroundImage: `url(${src.blur})` }} />
      {failed ? null : (
        <picture>
          <source type="image/avif" srcSet={src.avif} />
          <source type="image/webp" srcSet={src.webp} />
          <img
            className={`room-img${loaded ? " is-loaded" : ""}`}
            src={src.webp}
            alt=""
            decoding="async"
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
          />
        </picture>
      )}
    </div>
  );
}

/**
 * The full-bleed room behind every page: image, then the reactive light layer,
 * then the scrim that keeps text readable. Decorative, so hidden from assistive tech.
 */
export function Backdrop() {
  const { scene } = useScene();
  const { pathname } = useLocation();
  // On the play screens the room stays visible at the edges; menus get the left scrim.
  const view = pathname.startsWith("/room/") || pathname === "/training" ? "play" : "menu";
  const [shown, setShown] = useState<{ current: RoomId; leaving: RoomId | null }>({ current: scene.room, leaving: null });
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    setShown((s) => (s.current === scene.room ? s : { current: scene.room, leaving: s.current }));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setShown((s) => ({ ...s, leaving: null })), 800);
    warm(nextLikelyRoom(scene.room));
    return () => window.clearTimeout(timer.current);
  }, [scene.room]);

  return (
    <div className="scene" data-room={shown.current} data-dim={scene.dim ? "true" : "false"} data-view={view} aria-hidden="true" role="presentation">
      {shown.leaving ? <RoomLayer key={`out-${shown.leaving}`} room={shown.leaving} crossfade={false} /> : null}
      <RoomLayer key={`in-${shown.current}`} room={shown.current} crossfade={shown.leaving != null} />
      <Light room={shown.current} />
      <div className="scene-scrim" />
      <div className="scene-dim" />
    </div>
  );
}
