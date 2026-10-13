/**
 * Who may get a LiveKit join token, and as whom.
 *
 * Room codes are 4 digits, so anyone could guess one. A token is only minted
 * for a player who is already seated in that room (Socket.IO room:join,
 * queue match, or chaos:join, which seats walk-ins too), and its LiveKit
 * identity is that seat's public player id, never something the request
 * body chose.
 *
 * Pure so it can be tested without HTTP, Mongo, or LiveKit.
 */
export type SeatView = {
  id: string;
  clientId: string;
  displayName: string;
};

export type RoomView = {
  code: string;
  players: SeatView[];
};

export type LiveKitAccessError =
  | "BAD_REQUEST"
  | "ROOM_NOT_FOUND"
  | "NOT_SEATED"
  | "IDENTITY_MISMATCH";

export type LiveKitAccess =
  | { ok: true; roomCode: string; identity: string; displayName: string }
  | { ok: false; status: number; code: LiveKitAccessError; message: string };

/**
 * @param code        room code from the request body
 * @param room        the room, or undefined if no such room exists
 * @param clientId    the server-verified identity (httpIdentity)
 * @param requested   optional LiveKit identity the client expects to get;
 *                    if sent, it must be the seat's public id
 */
export function decideLiveKitAccess(input: {
  code: unknown;
  room: RoomView | undefined;
  clientId: string;
  requested?: unknown;
}): LiveKitAccess {
  const { code, room, clientId, requested } = input;
  if (typeof code !== "string" || !code.trim()) {
    return { ok: false, status: 400, code: "BAD_REQUEST", message: "room code required" };
  }
  if (!room || room.code !== code.trim()) {
    return { ok: false, status: 404, code: "ROOM_NOT_FOUND", message: "no such room" };
  }
  const seat = room.players.find((p) => p.clientId === clientId);
  if (!seat) {
    return {
      ok: false,
      status: 403,
      code: "NOT_SEATED",
      message: "join the room before opening cameras",
    };
  }
  if (requested !== undefined && requested !== null && requested !== "" && requested !== seat.id) {
    return {
      ok: false,
      status: 403,
      code: "IDENTITY_MISMATCH",
      message: "that is not your player",
    };
  }
  return { ok: true, roomCode: room.code, identity: seat.id, displayName: seat.displayName };
}
