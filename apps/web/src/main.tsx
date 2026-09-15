import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PostHogProvider } from "@posthog/react";
import App from "./App.tsx";
import { registerStageSlots } from "./stage/slots.tsx";
import { StageLyrics, StagePitch, StageResults } from "./stage/LaneBSlots.tsx";
import { initPostHog } from "./analytics/posthog.ts";
import "./index.css";
import "./styles.css";
// Last: the palette and the spectrum accents override both legacy sheets.
import "./theme/theme.css";
import "./results/results.css";

registerStageSlots({
  LyricsOverlay: StageLyrics,
  PitchMeter: StagePitch,
  ResultsModal: StageResults,
});

const host = document.getElementById("root");
if (!host) throw new Error("#root missing from index.html");

const posthog = initPostHog();

createRoot(host).render(
  <StrictMode>
    {posthog ? (
      <PostHogProvider client={posthog}>
        <App />
      </PostHogProvider>
    ) : (
      <App />
    )}
  </StrictMode>,
);
