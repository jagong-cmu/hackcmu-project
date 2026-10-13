export type Mode = "ranked" | "duet" | "training" | "chaos";

export type ScoreCard = {
  overall: number;
  pitch: number;
  tone: number;
  words?: number;
  silence: boolean;
  verdict: string;
  source: "dsp" | "dsp+gemini";
};

export type SongMeta = {
  id: string;
  title: string;
  artist: string;
  clipStartSec: number;
  clipDurationSec: number;
  duetClipStartSec: number;
  duetClipDurationSec: number;
  chaosDurationSec: number;
};

export type MelodyFile = {
  sampleRateHz: number;
  startSec: number;
  hz: Array<number | null>;
};

export type PlayerPublic = {
  id: string;
  clientId: string;
  displayName: string;
  elo: number;
  /** Lobby only. Omitted on player:ok (not seated yet). */
  ready?: boolean;
};

export type RoomStatus =
  | "lobby"
  | "countdown"
  | "turnA"
  | "swap"
  | "turnB"
  | "results"
  | "live";

export type RoomState = {
  code: string;
  mode: Mode;
  players: PlayerPublic[];
  songId: string | null;
  status: RoomStatus;
  activeSingerId: string | null;
  playAtUnixMs: number | null;
  playheadSec: number;
  /** Ranked/Duet results only: an open rematch offer both seats must confirm. */
  rematch?: RematchOffer | null;
  /** Why the last rematch offer closed without starting a match. Cleared by a new offer. */
  rematchLapse?: RematchLapse | null;
};

/**
 * Server-authoritative rematch window. Opens when the first player taps
 * Rematch; a match only starts once every seated player is in `requestedBy`.
 * Clients render the countdown from `deadlineUnixMs` via the synced clock.
 */
export type RematchOffer = {
  /** Player ids that have tapped Rematch, in tap order. `[0]` proposed it. */
  requestedBy: string[];
  openedAtUnixMs: number;
  deadlineUnixMs: number;
};

export type RematchLapseReason = "expired" | "declined" | "cancelled" | "left";

export type RematchLapse = {
  reason: RematchLapseReason;
  /** Who declined / cancelled / left. Null for a plain expiry. */
  byPlayerId: string | null;
  atUnixMs: number;
};
