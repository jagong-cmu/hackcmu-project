/**
 * Thin router only. Do not put logic here (TECHNICAL_PRD §4).
 */
import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Home } from "./home/Home.tsx";
import { Settings } from "./home/Settings.tsx";
import { Leaderboard } from "./leaderboard/Leaderboard.tsx";
import { ArenaStats } from "./leaderboard/ArenaStats.tsx";
import { RoomProvider } from "./rooms/RoomProvider.tsx";
import { AnalyticsRoot } from "./analytics/AnalyticsRoot.tsx";
import { RouteAmbient } from "./ui/Ambient.tsx";
import { DeviceCheckGate } from "./onboarding/DeviceCheckGate.tsx";
import { AuthProvider, RequireAuth } from "./auth/AuthProvider.tsx";
import { SignIn } from "./auth/SignIn.tsx";
import { PrivacyPolicy, TermsOfService } from "./legal/LegalPage.tsx";

// Heavy routes load on demand so Home doesn't ship TensorFlow (CREPE) and LiveKit.
const Play = lazy(() => import("./home/Play.tsx").then((m) => ({ default: m.Play })));
const Training = lazy(() => import("./training/Training.tsx").then((m) => ({ default: m.Training })));
const DeviceCheck = lazy(() => import("./onboarding/DeviceCheck.tsx").then((m) => ({ default: m.DeviceCheck })));
const VoiceCheck = lazy(() => import("./onboarding/VoiceCheck.tsx").then((m) => ({ default: m.VoiceCheck })));
const Stage = lazy(() => import("./stage/Stage.tsx"));
const ResultsPreview = lazy(() => import("./results/ResultsPreview.tsx").then((m) => ({ default: m.ResultsPreview })));
const SyncLyrics = lazy(() => import("./training/SyncLyrics.tsx").then((m) => ({ default: m.SyncLyrics })));
const PitchTest = lazy(() => import("./training/PitchTest.tsx").then((m) => ({ default: m.PitchTest })));

export default function App() {
  return (
    <BrowserRouter>
      <AnalyticsRoot />
      <RouteAmbient />
      <RoomProvider><AuthProvider>
        {/* Flat --bg while a route chunk loads: nothing to flash. */}
        <Suspense fallback={null}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/signin" element={<SignIn />} />
          <Route path="/privacy" element={<PrivacyPolicy />} />
          <Route path="/terms" element={<TermsOfService />} />
          {/* Home is the mode picker now; leaving a queue and the device checks land here. */}
          <Route path="/play" element={<Navigate to="/" replace />} />
          <Route path="/play/:mode" element={<RequireAuth><DeviceCheckGate><Play /></DeviceCheckGate></RequireAuth>} />
          <Route path="/check" element={<RequireAuth><DeviceCheck /></RequireAuth>} />
          <Route path="/check/voice" element={<RequireAuth><VoiceCheck /></RequireAuth>} />
          <Route path="/training" element={<RequireAuth><Training /></RequireAuth>} />
          {/* Debug tools: dev server only, never in the production bundle's routes. */}
          {import.meta.env.DEV ? (
            <>
              <Route path="/results-preview" element={<ResultsPreview />} />
              <Route path="/sync" element={<SyncLyrics />} />
              <Route path="/pitchtest" element={<PitchTest />} />
            </>
          ) : null}
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="/stats" element={<ArenaStats />} />
          <Route path="/room/:code" element={<RequireAuth><DeviceCheckGate><Stage /></DeviceCheckGate></RequireAuth>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </AuthProvider></RoomProvider>
    </BrowserRouter>
  );
}
