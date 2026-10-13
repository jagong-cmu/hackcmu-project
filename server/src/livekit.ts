/**
 * LANE A — LiveKit Cloud (Build tier) token minting.
 *
 * The server holds the API secret and hands each player a short-lived join
 * token. Cameras and mics go over LiveKit; the instrumental never does.
 */
import { AccessToken } from "livekit-server-sdk";

/**
 * Short on purpose: a token is not revoked when its player leaves, so its life
 * is the window in which it could be replayed. A connected participant stays
 * connected past expiry (the LiveKit server pushes refreshed tokens to live
 * connections, which the SDK uses for its own reconnects), and the client
 * mints a fresh one if it has to rejoin from scratch (media/useLiveKit.ts).
 */
export const TOKEN_TTL_SECONDS = 15 * 60;

export type LiveKitConfig = {
  apiKey: string;
  apiSecret: string;
  wsUrl: string;
};

export function readLiveKitConfig(): LiveKitConfig | null {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const wsUrl = process.env.LIVEKIT_WS_URL;
  if (!apiKey || !apiSecret || !wsUrl) return null;
  return { apiKey, apiSecret, wsUrl };
}

/**
 * LiveKit room names are namespaced so a 4-digit karaoke code can never
 * collide with another project sharing the same free Build tier.
 */
export function liveKitRoomName(code: string): string {
  return `karaoke-${code}`;
}

export async function mintToken(
  config: LiveKitConfig,
  code: string,
  identity: string,
  displayName: string,
): Promise<string> {
  const token = new AccessToken(config.apiKey, config.apiSecret, {
    identity,
    name: displayName,
    ttl: TOKEN_TTL_SECONDS,
  });
  token.addGrant({
    room: liveKitRoomName(code),
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });
  return token.toJwt();
}
