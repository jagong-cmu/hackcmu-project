/**
 * Thin router only. Do not put logic here (TECHNICAL_PRD §4).
 */
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Home } from "./home/Home.tsx";
import { Play } from "./home/Play.tsx";
import { ModeSelect } from "./home/ModeSelect.tsx";
import { Settings } from "./home/Settings.tsx";
import { Leaderboard } from "./leaderboard/Leaderboard.tsx";
import { ArenaStats } from "./leaderboard/ArenaStats.tsx";
import { DesignSystem } from "./theme/DesignSystem.tsx";
import { NotFound } from "./theme/NotFound.tsx";
import { PitchTest } from "./training/PitchTest.tsx";
import { SyncLyrics } from "./training/SyncLyrics.tsx";
import { ResultsPreview } from "./results/ResultsPreview.tsx";
import { Training } from "./training/Training.tsx";
import { RoomProvider } from "./rooms/RoomProvider.tsx";
import Stage from "./stage/Stage.tsx";
import { AnalyticsRoot } from "./analytics/AnalyticsRoot.tsx";
import { DeviceCheck } from "./onboarding/DeviceCheck.tsx";
import { DeviceCheckGate } from "./onboarding/DeviceCheckGate.tsx";
import { VoiceCheck } from "./onboarding/VoiceCheck.tsx";
import { AuthProvider, RequireAuth } from "./auth/AuthProvider.tsx";
import { SignIn } from "./auth/SignIn.tsx";
import { PrivacyPolicy, TermsOfService } from "./legal/LegalPage.tsx";

export default function App() {
  return (
    <BrowserRouter>
      <AnalyticsRoot />
      <RoomProvider><AuthProvider>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/signin" element={<SignIn />} />
          <Route path="/privacy" element={<PrivacyPolicy />} />
          <Route path="/terms" element={<TermsOfService />} />
          <Route path="/play" element={<RequireAuth><ModeSelect /></RequireAuth>} />
          <Route path="/play/:mode" element={<RequireAuth><DeviceCheckGate><Play /></DeviceCheckGate></RequireAuth>} />
          <Route path="/check" element={<RequireAuth><DeviceCheck /></RequireAuth>} />
          <Route path="/check/voice" element={<RequireAuth><VoiceCheck /></RequireAuth>} />
          <Route path="/training" element={<RequireAuth><Training /></RequireAuth>} />
          {/* Debug tools: dev server only, never in the production bundle's routes. */}
          {import.meta.env.DEV ? (
            <>
              <Route path="/system" element={<DesignSystem />} />
              <Route path="/results-preview" element={<ResultsPreview />} />
              <Route path="/sync" element={<SyncLyrics />} />
              <Route path="/pitchtest" element={<PitchTest />} />
            </>
          ) : null}
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="/stats" element={<ArenaStats />} />
          <Route path="/room/:code" element={<RequireAuth><DeviceCheckGate><Stage /></DeviceCheckGate></RequireAuth>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </AuthProvider></RoomProvider>
    </BrowserRouter>
  );
}
