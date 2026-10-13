/**
 * Per-machine bits of the mic + camera check: which mic and camera this
 * browser picked, plus the /check path helpers.
 *
 * Whether the check has been done is NOT stored here: that is per account
 * (onboardingState.ts / accountOnboarding.ts). Every storage access is
 * wrapped: private windows and blocked site data throw, and the check must
 * never break the play flow.
 */
import { safeNextPath } from "../lib/safeNext.ts";

const MIC_KEY = "karaoke.device.mic";
const CAM_KEY = "karaoke.device.camera";

export const CheckPath = "/check";

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage blocked; LiveKit falls back to the default devices */
  }
}

/** Remember the devices that passed the check on this machine. */
export function saveDevicePrefs(devices: { micId?: string; cameraId?: string }): void {
  if (devices.micId) write(MIC_KEY, devices.micId);
  if (devices.cameraId) write(CAM_KEY, devices.cameraId);
}

export function preferredMicId(): string | undefined {
  return read(MIC_KEY) || undefined;
}

export function preferredCameraId(): string | undefined {
  return read(CAM_KEY) || undefined;
}

/** Only same-origin paths, so `?next=` can't bounce anyone off-site. */
export function safeNext(raw: string | null, fallback = "/play"): string {
  const next = safeNextPath(raw, fallback);
  // Never loop back into the check itself.
  if (next === CheckPath || next.startsWith(`${CheckPath}?`) || next.startsWith(`${CheckPath}/`)) return fallback;
  return next;
}

export function checkPathFor(next: string): string {
  return `${CheckPath}?next=${encodeURIComponent(next)}`;
}
