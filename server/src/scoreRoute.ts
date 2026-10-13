/**
 * Score upload. The client runs the DSP locally and posts numbers — never a
 * 15s audio blob (TECHNICAL_PRD §5.2). Its own module so the malformed-body
 * tests can mount it without booting the whole server.
 *
 * Only the DSP pitch/tone are taken from the body; `overall` is recomputed
 * from them. The verdict is the server's (Gemini on the server's own lyrics,
 * else none) and so is the source label.
 *
 * One card per seat per match, only once that seat's clip is over, never after
 * settlement (clock.ts scoreRejection). Refusals are 409 with a `code`:
 * MATCH_NOT_STARTED, TURN_NOT_ENDED, STALE_MATCH, MATCH_SETTLED,
 * SCORE_ALREADY_RECORDED, NOT_A_SINGER, NOT_A_SCORED_MATCH; 503
 * SCORE_STORE_UNAVAILABLE when the cross-isolate claim cannot be written.
 * Optional body `matchId` (RoomState.matchId) pins the post to one match.
 */
import type { Express } from "express";
import type { Server } from "socket.io";

import { getRoom } from "./rooms.ts";
import { emitScoreReady, recordScore } from "./clock.ts";
import { ensureRoom, refreshClaimedCard } from "./liveState.ts";
import { clampCard, enrichScore, isScoreBody, verdictLyrics } from "./judge.ts";
import { httpIdentity } from "./auth.ts";
import { trackScoreSubmitted } from "./analytics.ts";
import { asyncRoute, logOnce, roomCodeOf } from "./hardening.ts";

export function registerScoreRoute(app: Express, io: Server): void {
  app.post(
    "/api/turns/:roomId/score",
    asyncRoute(async (req, res) => {
      const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
      // Verified identity first: the token's user id (only the local dev opt-out
      // trusts the secret clientId). A body naming someone else cannot post for them.
      const who = await httpIdentity(req, body.clientId);
      if (!who.ok) {
        res.status(who.status).json({ code: who.code, message: who.message });
        return;
      }
      const clientId = who.clientId;

      if (!isScoreBody(body.score)) {
        res.status(400).json({ code: "BAD_REQUEST", message: "clientId and score required" });
        return;
      }

      const code = roomCodeOf(req.params.roomId);
      const room = code ? ((await ensureRoom(code)) ?? getRoom(code)) : undefined;
      if (!room) {
        res.status(404).json({ code: "ROOM_NOT_FOUND", message: "no such room" });
        return;
      }

      const player = room.players.find((p) => p.clientId === clientId);
      if (!player) {
        res.status(404).json({ code: "PLAYER_NOT_IN_ROOM", message: "not seated here" });
        return;
      }

      // Pitch/tone clamped, overall recomputed from them (clampCard).
      const card = clampCard(body.score);
      const matchId = room.matchId;
      // Status, timing, one-per-seat, settled, and the cross-isolate claim (clock.ts).
      const outcome = await recordScore(io, room, player.id, card, body.matchId);
      if (!outcome.ok) {
        res.status(outcome.status).json({ code: outcome.code, message: outcome.message });
        return;
      }
      void trackScoreSubmitted({ distinctId: clientId, roomCode: room.code }).catch(
        logOnce("trackScoreSubmitted"),
      );
      res.json({ ok: true, settled: outcome.settled, score: card });
      void enrichScore(card, verdictLyrics(room.songId, body.lyrics))
        .then(async (enriched) => {
          if (enriched.verdict === card.verdict && enriched.source === card.source) return;
          // Verdict only; never replaces a card from a later match.
          if (room.matchId !== matchId || room.scores.get(player.id) !== card) return;
          room.scores.set(player.id, enriched);
          emitScoreReady(io, room, player.id, enriched);
          if (matchId != null) await refreshClaimedCard(room, matchId, player.id, enriched);
        })
        .catch(logOnce("enrichScore"));
    }),
  );
}
