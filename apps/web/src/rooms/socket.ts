/**
 * LANE A — Socket.IO client singleton.
 *
 * Empty VITE_SOCKET_URL means same-origin, which is what we want both behind
 * the Vite dev proxy and on the single Render service.
 */
import { io, type Socket } from "socket.io-client";
import { getAccessToken, jwtSubject } from "../auth/supabase.ts";

const CLIENT_ID_KEY = "karaoke.clientId";
const DISPLAY_NAME_KEY = "karaoke.displayName";

/**
 * Supabase user the current handshake was made as. `undefined` until the
 * first handshake has read the session.
 */
let handshakeUserId: string | null | undefined;

const socketOptions = {
  // Sent on every (re)connect, so the server can verify who this socket is.
  auth: (cb: (data: object) => void) => {
    void getAccessToken().then((token) => {
      handshakeUserId = token ? jwtSubject(token) : null;
      cb(token ? { token } : {});
    });
  },
  transports: ["websocket", "polling"] as ["websocket", "polling"],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 400,
  reconnectionDelayMax: 2000,
};

const url = import.meta.env.VITE_SOCKET_URL?.trim();
export const socket: Socket = url ? io(url, socketOptions) : io(socketOptions);

/** Reconnect when the signed-in user changes, so the server sees the new token. */
export function resyncSocketAuth(userId: string | null): void {
  if (handshakeUserId === undefined || handshakeUserId === userId) return;
  handshakeUserId = undefined;
  socket.disconnect();
  socket.connect();
}

/** Stable per-browser identity. No accounts in v1 (PRD §4). */
export function getClientId(): string {
  let id = localStorage.getItem(CLIENT_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(CLIENT_ID_KEY, id);
  }
  return id;
}

export function getDisplayName(): string {
  return localStorage.getItem(DISPLAY_NAME_KEY) ?? "";
}

export function setDisplayName(name: string): void {
  localStorage.setItem(DISPLAY_NAME_KEY, name);
}
