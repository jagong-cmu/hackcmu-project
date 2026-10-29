/**
 * Dev-only mock of the singing view, so the machine can be checked without a
 * match, a mic or LiveKit. Open /results-preview?machine=ranked (or training).
 * ?voice=on (default) sings the melody, off sings it 3 semitones sharp,
 * silent sends no pitch. ?count=1 shows the countdown, ?end=1 the results.
 * ?song=<id> picks the song (default creep). ?dur=<sec> plays that long (e.g. 180 to profile).
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { MelodyFile, ScoreCard, SongMeta } from "@karaoke/shared";
import { loadSongPack } from "../scoring/catalog.ts";
import { melodyHzAt } from "../scoring/scoreClip.ts";
import { PitchMeter } from "../scoring/PitchMeter.tsx";
import { LyricsOverlay } from "../lyrics/LyricsOverlay.tsx";
import { ResultsModal } from "../results/ResultsModal.tsx";
import CountdownOverlay from "./CountdownOverlay.tsx";
import { mmss, ProgressBar } from "./ClipTimer.tsx";
import { KaraokeMachine, MachineStage, ModeTabs, ScorePanel } from "./KaraokeMachine.tsx";
import { KeyHintBar } from "../ui/KeyHints.tsx";
import { Digits } from "../ui/Digits.tsx";

function CamOff({ name }: { name: string }) {
  return (
    <div className="stage-cam">
      <div className="tile">
        <div className="placeholder cam-initial">{name[0]}</div>
      </div>
    </div>
  );
}

export function MachinePreview() {
  const navigate = useNavigate();
  const params = new URLSearchParams(window.location.search);
  const ranked = params.get("machine") === "ranked";
  const voice = params.get("voice") ?? "on";
  const [pack, setPack] = useState<{ meta: SongMeta; melody: MelodyFile; lrc: string } | null>(null);
  const [t, setT] = useState(0);
  const [combo, setCombo] = useState(0);

  useEffect(() => {
    void loadSongPack(params.get("song") ?? "creep").then(setPack);
  }, []);

  const startSec = pack ? (pack.meta.firstLyricSec ?? pack.meta.clipStartSec) - 2 : 0;
  const durationSec = Number(params.get("dur")) || (pack?.meta.clipDurationSec ?? 30);
  useEffect(() => {
    if (!pack) return;
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      setT(startSec + (((now - t0) / 1000) % durationSec));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [pack, startSec, durationSec]);

  if (!pack) return null;
  const target = melodyHzAt(pack.melody, t);
  const liveHz = voice === "silent" || target == null ? null : voice === "off" ? target * 2 ** (3 / 12) : target;
  const you: ScoreCard = voice === "on"
    ? { overall: 86, pitch: 88, tone: 79, silence: false, verdict: "", source: "dsp" }
    : { overall: 52, pitch: 41, tone: 70, silence: false, verdict: "", source: "dsp" };
  const them: ScoreCard = { overall: 74, pitch: 71, tone: 80, silence: false, verdict: "", source: "dsp" };
  const elapsed = t - startSec;

  return (
    <div className="stage stage-fit km-page">
      {ranked ? <ModeTabs mode="ranked" /> : null}
      <MachineStage>
        <div className="km-row">
          <ScorePanel side="you" name="Riley" camera={<CamOff name="Riley" />} card={you} combo={combo} />
          <KaraokeMachine
            title={pack.meta.title}
            label={ranked ? "Ranked · Turn A" : "Training"}
            time={<Digits value={`${mmss(elapsed)} / ${mmss(durationSec)}`} />}
            lanes={
              <div className="pitch-stage">
                <PitchMeter melody={pack.melody} playheadSec={t} liveHz={liveHz} liveClarity={0.97} liveRms={0.05} onCombo={setCombo} />
              </div>
            }
            lyrics={<LyricsOverlay lrc={pack.lrc} currentTime={t} />}
            lock={you.pitch}
          />
          {ranked ? <ScorePanel side="them" name="Alex" camera={<CamOff name="Alex" />} card={null} combo={0} /> : <span />}
        </div>
        <ProgressBar label={`${pack.meta.title} · ${pack.meta.artist}`} elapsedSec={elapsed} durationSec={durationSec} />
      </MachineStage>
      <KeyHintBar hints={[{ keys: ["Esc"], label: "Leave" }]} />
      {params.has("count") ? <CountdownOverlay remainingMs={3400} singing /> : null}
      {params.has("end") ? (
        <div className="stage-results-layer">
        <ResultsModal
          you={you}
          youName="Riley"
          opponent={ranked ? them : null}
          opponentName="Alex"
          winnerId={ranked ? "a" : null}
          youId="a"
          opponentId="b"
          eloDelta={ranked ? 16 : null}
          songTitle={pack.meta.title}
          songArtist={pack.meta.artist}
          onHome={() => navigate("/")}
          onRematch={ranked ? () => undefined : undefined}
          onAgain={ranked ? undefined : () => undefined}
          onPickSong={() => undefined}
        />
        </div>
      ) : null}
    </div>
  );
}
