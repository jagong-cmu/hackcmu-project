import type { ScoreCard } from "@karaoke/shared";

export type CoachLine = {
  kicker: string;
  line: string;
};

type Bits = Pick<ScoreCard, "overall" | "pitch" | "tone" | "silence">;

function pick(lines: string[], seed: number): string {
  const i = Math.abs(Math.trunc(seed)) % lines.length;
  return lines[i] ?? lines[0] ?? "";
}

export function coachLine(
  card: Bits,
  ctx: {
    won?: boolean | null;
    draw?: boolean;
    shared?: number | null;
  } = {},
): CoachLine {
  if (card.silence) {
    return {
      kicker: "Mic check",
      line: "We couldn't hear you. Get a little closer and hit it again.",
    };
  }

  const { overall, pitch, tone } = card;
  const seed = overall * 13 + pitch * 7 + tone;
  const pitchGap = tone - pitch;
  const toneGap = pitch - tone;

  if (ctx.shared != null) {
    if (overall >= 80) {
      return { kicker: "Blend", line: "Oh, you killed it together. That blend is locked in." };
    }
    if (overall >= 55) {
      return {
        kicker: "Together",
        line: "Nice duet. A little more pitch lock and this one sings.",
      };
    }
    return {
      kicker: "Again",
      line: "The blend is shy. Lean in together and run the chorus back.",
    };
  }

  if (ctx.draw) {
    return {
      kicker: "Dead heat",
      line: "Dead even. One more chorus and someone blinks.",
    };
  }

  if (ctx.won === false) {
    if (overall >= 70) {
      return {
        kicker: "Close",
        line: "They edged you. You were right there — run it back.",
      };
    }
    return {
      kicker: "Rematch",
      line: "They take this one. Warm up the voice and go again.",
    };
  }

  if (ctx.won === true && overall >= 75) {
    return {
      kicker: "Yours",
      line: pick(
        ["Oh, you killed it.", "That chorus is yours now.", "You ate that. The room felt it."],
        seed,
      ),
    };
  }

  if (overall >= 90) {
    return {
      kicker: "Killed it",
      line: pick(
        ["Oh, you killed it.", "That was a weapon. Don't even look at the mic."],
        seed,
      ),
    };
  }
  if (overall >= 80) {
    return {
      kicker: "Fire",
      line: pick(
        ["That went off. Pitch locked, room felt it.", "Oh, you killed it. Keep that energy."],
        seed,
      ),
    };
  }
  if (overall >= 70) {
    if (pitchGap >= 12) {
      return {
        kicker: "Close",
        line: "Tone was warm — lock the pitch a little tighter and you'd own it.",
      };
    }
    if (toneGap >= 12) {
      return {
        kicker: "Close",
        line: "Pitch landed. Give the mic a little more color next time.",
      };
    }
    return {
      kicker: "Solid",
      line: "Solid take. One more pass and you'll be scary.",
    };
  }
  if (overall >= 55) {
    if (pitchGap >= 10) {
      return {
        kicker: "Pitch",
        line: "You could work a little more on your pitch — the tone's already there.",
      };
    }
    if (toneGap >= 10) {
      return {
        kicker: "Open up",
        line: "Notes were close. Lean into the mic and let the voice bloom.",
      };
    }
    return {
      kicker: "Keep going",
      line: "Oh, you could work a little more on your voice. The shape is there.",
    };
  }
  if (overall >= 40) {
    return {
      kicker: "Rough take",
      line: "Rough take. Hit it again — this chorus wants another shot.",
    };
  }
  return {
    kicker: "Warm up",
    line: "Shake it off. A little louder, a little closer to the melody.",
  };
}
