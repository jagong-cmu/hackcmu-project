# Session C followups

Requests from the singing-view / results restyle for files C does not own.

## B: put Training in the machine (`training/Training.tsx`)

C's components are ready, but the Training layout is B's. Replace the `<LyricsOverlay>`, `.pitch-stage` and `.stage-self` block with the machine.
- `/results-preview?machine=training` shows the target. It uses the same components with mock data, in `stage/MachinePreview.tsx`.
- Drop the `LiveScoreHud` from Training; the panel shows the same `liveCard`.

```tsx
import { KaraokeMachine, MachineStage, ScorePanel } from "../stage/KaraokeMachine.tsx";
import { mmss, ProgressBar } from "../stage/ClipTimer.tsx";
import { Digits } from "../ui/Digits.tsx";

const [combo, setCombo] = useState(0);
const elapsed = trainingClip ? playhead - trainingClip.startSec : 0;
const total = trainingClip?.durationSec ?? meta?.clipDurationSec ?? 0;

<MachineStage>
  <div className="km-row">
    <ScorePanel side="you" name={getDisplayName() || "You"} card={liveCard} combo={combo}
      camera={<div className="stage-cam"><div className="tile">
        {camDenied ? <div className="placeholder cam-initial">{(getDisplayName() || "Y")[0]}</div>
                   : <video ref={videoRef} muted playsInline />}
      </div></div>} />
    <KaraokeMachine title={meta?.title ?? "Training"} label="Training"
      time={<Digits value={`${mmss(elapsed)} / ${mmss(total)}`} />}
      lanes={<div className="pitch-stage"><PitchMeter … onCombo={setCombo} />
        {running ? <HitCallout grade={…} /> : null}</div>}
      lyrics={<LyricsOverlay … />}
      lock={liveCard?.pitch ?? null} />
    <span />
  </div>
  <ProgressBar label={meta ? `${meta.title} · ${meta.artist}` : "Training"} elapsedSec={elapsed} durationSec={total} />
</MachineStage>
```

Two more things for B:
- `ResultsModal` now takes `onPickSong`. Pass it to show "Pick another song", e.g. close the card and focus the song select.
- The `.stage-self` rules can go.

## QA

- **Legacy rules to delete:** the machine beats all of these by specificity, so this is clean-up only, not a blocker.
  - `theme/theme.css` `.lyrics::before`: a `filter: blur(18px)` glow. It is hidden in the machine; still drawn in Training until B moves over.
  - `theme/theme.css` `.pitch-guide`: `backdrop-filter: blur(3px)`. The design system bans it, and the machine overrides it.
  - `theme/theme.css` `.lyric-sparks*` and `.score-burst` (the `display: none` line plus the spark keyframes). C deleted `LyricSparks.tsx` and `ScoreBurst.tsx`.
  - `index.css` `.pitch-guide { height: 280px; margin: 24px 0 }`: a pre-machine size.
- **`theme/palette.ts`:**
  - `tone()` calls `getPropertyValue` on every call. `PitchMeter` now resolves its colours once (`colors()`), but other canvas callers per frame would pay it.
  - Please add `--muted-rgb` to `tokens.css`. The lane reads `--muted` raw and uses `globalAlpha` for "missed 30%".
- **`ui/ui.css` `.key-hints`:** inside `.stage-fit` the legacy `.stage.stage-fit > *` rule (`styles.css`, C's file) turns it `position: relative`. `machine.css` restores `fixed` for `.km-page` only. Worth a note in the design system.

## Scoring (nobody owns it; for the team)

- **No TIMING score exists.** `ScoreBits` is pitch, tone and overall. The panels and results show **TONE** where the brief said TIMING.
- **Combo is display only.** It counts notes in a row in `PitchMeter`: a note is "hit" if ≥40% of its frames had the detector's `inTune`.
  - It never reaches scoring.
  - Hit and missed note colours use the same rule.
- **Lyric "sung portion" is estimated.** LRC only times whole lines, so each word starts at its character share of the line's span. That is the same limit that turned the old wipe off. Real word timing needs word-level LRC or the melody's note onsets.
