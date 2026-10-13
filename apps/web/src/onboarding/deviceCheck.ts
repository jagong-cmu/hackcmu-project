/**
 * Persistence for the mic + camera check that runs before a singer's first
 * real match. Every storage access is wrapped: private windows and blocked
 * site data throw, and the check must never break the play flow.
 */

const DONE_KEY = "karaoke.deviceCheck.v1";
const SKIP_KEY = "karaoke.deviceCheck.skipped";
const MIC_KEY = "karaoke.device.mic";
const CAM_KEY = "karaoke.device.camera";

export const CheckPath = "/check";

/** In-memory fallbacks for when storage is unavailable. */
let doneThisTab = false;
let skippedThisTab = false;

function read(store: () => Storage, key: string): string | null {
  try {
    return store().getItem(key);
  } catch {
    return null;
  }
}

function write(store: () => Storage, key: string, value: string | null): void {
  try {
    if (value == null) store().removeItem(key);
    else store().setItem(key, value);
  } catch {
    /* storage blocked; the in-memory flag covers this tab */
  }
}

const local = () => window.localStorage;
const session = () => window.sessionStorage;

/** True once the singer has passed the check, or skipped it this session. */
export function deviceCheckCleared(): boolean {
  if (doneThisTab || skippedThisTab) return true;
  return read(local, DONE_KEY) === "1" || read(session, SKIP_KEY) === "1";
}

export function markDeviceCheckDone(devices: { micId?: string; cameraId?: string }): void {
  doneThisTab = true;
  write(local, DONE_KEY, "1");
  if (devices.micId) write(local, MIC_KEY, devices.micId);
  if (devices.cameraId) write(local, CAM_KEY, devices.cameraId);
}

/** "Skip for now" lets them through for this session only. */
export function skipDeviceCheckForSession(): void {
  skippedThisTab = true;
  write(session, SKIP_KEY, "1");
}

export function preferredMicId(): string | undefined {
  return read(local, MIC_KEY) || undefined;
}

export function preferredCameraId(): string | undefined {
  return read(local, CAM_KEY) || undefined;
}

/** Only same-origin paths, so `?next=` can't bounce anyone off-site. */
export function safeNext(raw: string | null, fallback = "/play"): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith(CheckPath)) {
    return fallback;
  }
  return raw;
}

export function checkPathFor(next: string): string {
  return `${CheckPath}?next=${encodeURIComponent(next)}`;
}
