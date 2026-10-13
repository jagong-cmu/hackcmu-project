/**
 * Room safety over the socket: report, block, remove, and the no-penalty
 * leave from a 1v1 (server/src/moderation.ts has the rules).
 *
 * Blocks apply locally the moment you tap, before the server answers, so the
 * person disappears and goes silent right away.
 */
import { useCallback, useEffect, useState } from "react";
import {
  ClientEvents,
  RemovedFromRoomCode,
  ServerEvents,
  type SafetyAck,
  type SafetyNotice,
  type SafetyRemoved,
  type SafetyReportRequest,
  type SafetyState,
} from "@karaoke/shared";
import { socket } from "./socket.ts";

const ACK_MS = 8000;

function ask<T>(event: string, payload?: unknown): Promise<T | null> {
  return new Promise((resolve) => {
    socket.timeout(ACK_MS).emit(event, payload ?? {}, (err: unknown, reply: T) => {
      resolve(err ? null : reply);
    });
  });
}

const offline = (action: SafetyAck["action"]): SafetyAck => ({
  action,
  ok: false,
  message: "Couldn't reach the server. Try again.",
});

export type SafetyApi = {
  state: SafetyState | null;
  /** Player ids you have blocked. */
  blocked: Set<string>;
  /** Targets you already voted to remove. */
  myVotes: Set<string>;
  removed: SafetyRemoved | null;
  notice: SafetyNotice | null;
  dismissNotice: () => void;
  report: (req: SafetyReportRequest) => Promise<SafetyAck>;
  block: (targetId: string) => Promise<SafetyAck>;
  kick: (targetId: string) => Promise<SafetyAck>;
  leave: () => Promise<SafetyAck>;
};

/** `code` is the room you are seated in (null while joining). */
export function useSafety(code: string | null, attemptedCode: string): SafetyApi {
  const [state, setState] = useState<SafetyState | null>(null);
  const [blocked, setBlocked] = useState<Set<string>>(() => new Set());
  const [myVotes, setMyVotes] = useState<Set<string>>(() => new Set());
  const [removed, setRemoved] = useState<SafetyRemoved | null>(null);
  const [notice, setNotice] = useState<SafetyNotice | null>(null);

  useEffect(() => {
    setRemoved(null);
    setNotice(null);
  }, [attemptedCode]);

  useEffect(() => {
    if (!code) return;
    const sync = () => {
      void ask<SafetyState | null>(ClientEvents.safetySync).then((reply) => {
        if (!reply || reply.code !== code) return;
        setState(reply);
        if (reply.blocked) setBlocked((prev) => new Set([...prev, ...reply.blocked!]));
        if (reply.myVotes) setMyVotes(new Set(reply.myVotes));
      });
    };
    sync();
    socket.on("connect", sync);
    return () => {
      socket.off("connect", sync);
    };
  }, [code]);

  useEffect(() => {
    const onState = (next: SafetyState) => {
      if (next.code !== code) return;
      setState((prev) => ({ ...next, blocked: prev?.blocked, myVotes: prev?.myVotes }));
    };
    const onRemoved = (payload: SafetyRemoved) => {
      if (payload.code === attemptedCode) setRemoved(payload);
    };
    const onNotice = (payload: SafetyNotice) => {
      if (payload.code === code) setNotice(payload);
    };
    const onError = (payload: { code?: string; message?: string }) => {
      if (payload?.code !== RemovedFromRoomCode) return;
      setRemoved({
        code: attemptedCode,
        reason: "host",
        message: payload.message ?? "You were removed from this room.",
      });
    };
    socket.on(ServerEvents.safetyState, onState);
    socket.on(ServerEvents.safetyRemoved, onRemoved);
    socket.on(ServerEvents.safetyNotice, onNotice);
    socket.on(ServerEvents.error, onError);
    return () => {
      socket.off(ServerEvents.safetyState, onState);
      socket.off(ServerEvents.safetyRemoved, onRemoved);
      socket.off(ServerEvents.safetyNotice, onNotice);
      socket.off(ServerEvents.error, onError);
    };
  }, [code, attemptedCode]);

  const hideNow = useCallback((targetId: string) => {
    setBlocked((prev) => (prev.has(targetId) ? prev : new Set([...prev, targetId])));
  }, []);

  const report = useCallback(
    async (req: SafetyReportRequest) => {
      if (req.block) hideNow(req.targetId);
      return (await ask<SafetyAck>(ClientEvents.safetyReport, req)) ?? offline("report");
    },
    [hideNow],
  );

  const block = useCallback(
    async (targetId: string) => {
      hideNow(targetId);
      return (await ask<SafetyAck>(ClientEvents.safetyBlock, { targetId })) ?? offline("block");
    },
    [hideNow],
  );

  const kick = useCallback(async (targetId: string) => {
    const ack = (await ask<SafetyAck>(ClientEvents.safetyKick, { targetId })) ?? offline("kick");
    if (ack.ok) setMyVotes((prev) => new Set([...prev, targetId]));
    return ack;
  }, []);

  const leave = useCallback(
    async () => (await ask<SafetyAck>(ClientEvents.safetyLeave)) ?? offline("leave"),
    [],
  );

  const dismissNotice = useCallback(() => setNotice(null), []);

  return { state, blocked, myVotes, removed, notice, dismissNotice, report, block, kick, leave };
}
