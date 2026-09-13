import type { ScoreCard } from "@karaoke/shared";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ResultsModal, ScoringWait } from "./ResultsModal.tsx";

const MOCK: ScoreCard = {
  overall: 87,
  pitch: 84,
  tone: 92,
  silence: false,
  verdict: "Pitch locked on the chorus. Tone stayed warm all the way through.",
  source: "dsp+gemini",
};

const MOCK_THEM: ScoreCard = {
  overall: 73,
  pitch: 70,
  tone: 79,
  silence: false,
  verdict: "",
  source: "dsp",
};

/**
 * Dev-only stage for the score reveal. Open /results-preview.
 * Add ?wait=1 for the judging booth, ?loss=1 for a loss, ?low=1 for a rough take.
 */
export function ResultsPreview() {
  const navigate = useNavigate();
  const params = new URLSearchParams(window.location.search);
  const wait = params.has("wait");
  const loss = params.has("loss");
  const low = params.has("low");
  const split = !params.has("solo");
  const [showWait, setShowWait] = useState(wait);

  useEffect(() => {
    if (!wait) return;
    const t = window.setTimeout(() => setShowWait(false), 2800);
    return () => window.clearTimeout(t);
  }, [wait]);

  if (showWait) return <ScoringWait />;

  const you: ScoreCard = low
    ? { ...MOCK, overall: 48, pitch: 44, tone: 58, verdict: "" }
    : loss
      ? MOCK_THEM
      : MOCK;
  const them: ScoreCard = loss ? MOCK : MOCK_THEM;

  return (
    <ResultsModal
      you={you}
      youName="You"
      opponent={split ? them : null}
      opponentName="Alex"
      revealOpponent
      winnerId={split ? (loss ? "b" : "a") : null}
      youId="a"
      opponentId="b"
      eloDelta={split ? (loss ? -12 : 16) : null}
      onHome={() => navigate("/")}
      onRematch={() => navigate("/")}
    />
  );
}
