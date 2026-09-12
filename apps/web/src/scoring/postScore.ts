import type { ScoreCard } from "@karaoke/shared";

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
  const res = await fetch(`/api/turns/${encodeURIComponent(roomId)}/score`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}
