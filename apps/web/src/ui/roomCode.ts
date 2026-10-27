/** A room code is exactly four ASCII digits. 0000 is the permanent demo room and is valid. */
export function isRoomCode(s: string): boolean {
  return /^[0-9]{4}$/.test(s);
}

/** Typing filter: digits only, at most four. */
export function normalizeRoomCode(raw: string): string {
  return raw.replace(/[^0-9]/g, "").slice(0, 4);
}
