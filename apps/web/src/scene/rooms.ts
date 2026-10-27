import type { Mode } from "@karaoke/shared";

/** The four rooms. Chaos is the Party room; every other mode has its own. */
export type RoomId = "ranked" | "duet" | "training" | "party";

/** In menu order, so "next likely room" is the next item down. */
export const RoomIds: readonly RoomId[] = ["ranked", "duet", "training", "party"];

/** Before a selection, and for sign-in, settings and errors. */
export const DefaultRoom: RoomId = "ranked";

export type Scene = { room: RoomId; dim: boolean };

const BY_MODE: Record<Mode, RoomId> = {
  ranked: "ranked",
  duet: "duet",
  training: "training",
  chaos: "party",
};

export function roomForMode(mode: string | null | undefined): RoomId {
  return mode != null && Object.hasOwn(BY_MODE, mode) ? BY_MODE[mode as Mode] : DefaultRoom;
}

export type SceneOpts = {
  /** The live room's own mode (room 0000 and private rooms), once its state is known. */
  roomMode?: string | null;
  /** The main menu's current selection. */
  menuRoom?: RoomId | null;
  leaderboardTab?: "ranked" | "duet";
};

/** Which room a path shows, and whether it is darkened (non-game pages). */
export function sceneFor(pathname: string, opts: SceneOpts = {}): Scene {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (path === "/" || path === "/play") return { room: opts.menuRoom ?? DefaultRoom, dim: false };
  if (path === "/training") return { room: "training", dim: false };
  const play = path.match(/^\/play\/([^/]+)$/);
  if (play) return { room: roomForMode(play[1]), dim: false };
  if (path.startsWith("/room/")) return { room: roomForMode(opts.roomMode), dim: false };
  if (path === "/leaderboard") return { room: opts.leaderboardTab === "duet" ? "duet" : "ranked", dim: false };
  return { room: DefaultRoom, dim: true };
}

/** The room to preload while the current one is on screen: the next menu item, wrapping. */
export function nextLikelyRoom(room: RoomId): RoomId {
  return RoomIds[(RoomIds.indexOf(room) + 1) % RoomIds.length];
}

/** Owner-supplied assets, under apps/web/public/rooms/. See public/rooms/README.md. */
export function roomImages(room: RoomId): { avif: string; webp: string; blur: string } {
  return { avif: `/rooms/${room}.avif`, webp: `/rooms/${room}.webp`, blur: `/rooms/${room}-blur.webp` };
}

/** Where the TV glow sits per room (percent of the viewport). Tuned to the delivered images. */
export const TvGlow: Record<RoomId, { x: number; y: number; size: number }> = {
  ranked: { x: 82, y: 30, size: 34 },
  duet: { x: 84, y: 28, size: 34 },
  training: { x: 80, y: 32, size: 30 },
  party: { x: 86, y: 26, size: 40 },
};
