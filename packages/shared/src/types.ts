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
};
