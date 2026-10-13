/**
 * LANE A — Socket.IO client singleton.
 *
 * Empty VITE_SOCKET_URL means same-origin, which is what we want both behind
 * the Vite dev proxy and on the single Render service.
 */
import { io, type Socket } from "socket.io-client";
import { getAccessToken, getSupabase, jwtSubject } from "../auth/supabase.ts";

const CLIENT_ID_KEY = "karaoke.clientId";
const DISPLAY_NAME_KEY = "karaoke.displayName";

/**
 * Supabase user the current handshake was made as. `undefined` until the
 * first handshake has read the session.
 */
let handshakeUserId: string | null | undefined;

/**
 * Newest access token we know of, sent with every player:hello so the server
 * can re-verify a socket whose handshake token was missing or has expired.
 */
let latestAccessToken: string | null = null;

/** AuthProvider feeds every session change (sign-in, refresh, sign-out) here. */
export function setLatestAccessToken(token: string | null): void {
  latestAccessToken = token;
}

/** player:hello body. The token lets the server heal the socket in place. */
export function helloPayload(displayName: string): {
  clientId: string;
  displayName: string;
  accessToken?: string;
} {
  return latestAccessToken
    ? { clientId: getClientId(), displayName, accessToken: latestAccessToken }
    : { clientId: getClientId(), displayName };
}

const socketOptions = {
  // Sent on every (re)connect, so the server can verify who this socket is.
  auth: (cb: (data: object) => void) => {
    void getAccessToken().then((token) => {
      handshakeUserId = token ? jwtSubject(token) : null;
      if (token) latestAccessToken = token;
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

let lastRecoveryAt = 0;

/**
 * The server said "sign in" but this tab thinks it is signed in: the token it
 * holds is stale. Refresh the session once. True means a fresh token is ready
 * to send with the next hello; false means the session is really gone, so it
 * is cleared locally (the app then routes to /signin). Throttled so a server
 * that keeps refusing cannot loop us.
 */
export async function recoverSocketAuth(): Promise<boolean | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const now = Date.now();
  if (now - lastRecoveryAt < 10_000) return null;
  lastRecoveryAt = now;
  const { data } = await sb.auth.getSession();
  if (!data.session) return null; // signed out: the sign-in gate handles it
  const { data: refreshed, error } = await sb.auth.refreshSession();
  const token = refreshed.session?.access_token ?? null;
  if (error || !token) {
    // Local only: never revoke this account's sessions on other devices.
    await sb.auth.signOut({ scope: "local" });
    latestAccessToken = null;
    return false;
  }
  latestAccessToken = token;
  return true;
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
