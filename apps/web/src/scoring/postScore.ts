import { ScorePostPath, type ScoreCard } from "@karaoke/shared";
import { authHeaders } from "../auth/supabase.ts";

const ATTEMPTS = 3;

/**
 * The server refused the score for good (409): the match is settled, over, or
 * this seat already has its one score. Retrying cannot change the answer.
 */
export class ScoreRefused extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(`score refused ${status} ${code}`);
  }
  /** TURN_NOT_ENDED: posted before the clip was over. Worth one more flush later. */
  get final(): boolean {
    return this.code !== "TURN_NOT_ENDED";
  }
}

export async function postTurnScore(
  roomId: string,
  body: {
    clientId: string;
    displayName?: string;
    score: ScoreCard;
    /** RoomState.matchId when this clip started: the server refuses it for a later match. */
    matchId?: number | null;
    mode?: string;
    songId?: string;
    lyrics?: string;
    opponentClientId?: string;
    opponentName?: string;
    forfeit?: boolean;
    elapsedMs?: number;
  },
) {
  const path = ScorePostPath.replace(":roomId", encodeURIComponent(roomId));
  let lastError: unknown;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(body),
      });
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
      continue;
    }
    if (res.ok) return await res.json();
    if (res.status === 409) {
      const data = (await res.json().catch(() => null)) as { code?: unknown } | null;
      const code = typeof data?.code === "string" ? data.code : "CONFLICT";
      // A retry whose first attempt landed (reply lost): the score is in.
      if (code === "SCORE_ALREADY_RECORDED") return { ok: true, alreadyRecorded: true };
      throw new ScoreRefused(code, res.status);
    }
    lastError = new Error(`score post ${res.status}`);
    await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
  }
  throw lastError;
}
