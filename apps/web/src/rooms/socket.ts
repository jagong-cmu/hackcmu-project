/**
 * LANE A — Socket.IO client singleton.
 *
 * Empty VITE_SOCKET_URL means same-origin, which is what we want both behind
 * the Vite dev proxy and on the single Render service.
 */
import { io, type Socket } from "socket.io-client";

const CLIENT_ID_KEY = "karaoke.clientId";
const DISPLAY_NAME_KEY = "karaoke.displayName";

const socketOptions = {
  transports: ["websocket", "polling"] as ["websocket", "polling"],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 400,
  reconnectionDelayMax: 2000,
};

const url = import.meta.env.VITE_SOCKET_URL?.trim();
export const socket: Socket = url ? io(url, socketOptions) : io(socketOptions);

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
