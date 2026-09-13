import { ScorePostPath, type ScoreCard } from "@karaoke/shared";

const ATTEMPTS = 3;

export async function postTurnScore(
  roomId: string,
  body: {
    clientId: string;
    displayName?: string;
    score: ScoreCard;
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
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`score post ${res.status}`);
      return await res.json();
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    }
  }
  throw lastError;
}
