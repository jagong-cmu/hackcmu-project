/**
 * Every image the UI may show, as paths under public/images/. The app must
 * work without any of them: render them only through <Img>, which shows
 * nothing when a file is missing. Files are exported at 2x their display size.
 */
const dir = "/images";

export const Images = {
  /** 2752px wide; heroHome1x is 1600px. Use both as a srcset. */
  heroHome: `${dir}/hero-home.webp`,
  heroHome1x: `${dir}/hero-home-1600.webp`,
  mode: {
    ranked: `${dir}/mode-ranked.webp`,
    duet: `${dir}/mode-duet.webp`,
    training: `${dir}/mode-training.webp`,
    chaos: `${dir}/mode-chaos.webp`,
    room: `${dir}/mode-room.webp`,
    // No leaderboard art yet: add `leaderboard: `${dir}/mode-leaderboard.webp`` when the file exists.
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
