/**
 * Voice range check paths.
 *
 * The profile itself lives on the account (user_metadata.voice_profile, see
 * onboardingState.ts) and is read with `useVoiceProfile()` from
 * AuthProvider. It only steers the live pitch visualizer
 * (scoring/voiceRange.ts); it never reaches scoring or the server.
 */
import { CheckPath } from "./deviceCheck.ts";

export const VoiceCheckPath = `${CheckPath}/voice`;

export function voiceCheckPathFor(next: string): string {
  return `${VoiceCheckPath}?next=${encodeURIComponent(next)}`;
}
