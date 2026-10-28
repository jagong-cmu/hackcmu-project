/**
 * Every image the UI may show, as paths under public/images/. None of these
 * files exist yet and the app must work without them: render them only
 * through <Img>, which shows nothing when a file is missing.
 */
const dir = "/images";

export const Images = {
  heroHome: `${dir}/hero-home.webp`,
  mode: {
    ranked: `${dir}/mode-ranked.webp`,
    duet: `${dir}/mode-duet.webp`,
    training: `${dir}/mode-training.webp`,
    chaos: `${dir}/mode-chaos.webp`,
    room: `${dir}/mode-room.webp`,
    leaderboard: `${dir}/mode-leaderboard.webp`,
  },
  /** Fallback song art, art-01 … art-06. */
  art: [1, 2, 3, 4, 5, 6].map((n) => `${dir}/art-0${n}.webp`),
  /** Optional backdrop for the singing view. */
  stageBg: `${dir}/stage-bg.webp`,
  /** Social share image (absolute URL in index.html's og:image once it exists). */
  og: `${dir}/og.png`,
} as const;

/** A stable fallback art image for a song, so the same song always gets the same art. */
export function artFor(songId: string): string {
  let h = 0;
  for (const ch of songId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return Images.art[h % Images.art.length]!;
}
