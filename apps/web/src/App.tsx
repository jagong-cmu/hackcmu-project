/**
 * Thin router only. Do not put logic here (TECHNICAL_PRD §4).
 */
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Home } from "./home/Home.tsx";
import { Play } from "./home/Play.tsx";
import { ModeSelect } from "./home/ModeSelect.tsx";
import { Settings } from "./home/Settings.tsx";
import { Leaderboard } from "./leaderboard/Leaderboard.tsx";
import { ArenaStats } from "./leaderboard/ArenaStats.tsx";
import { PitchTest } from "./training/PitchTest.tsx";
import { SyncLyrics } from "./training/SyncLyrics.tsx";
import { ResultsPreview } from "./results/ResultsPreview.tsx";
import { Training } from "./training/Training.tsx";
import { RoomProvider } from "./rooms/RoomProvider.tsx";
import Stage from "./stage/Stage.tsx";
import { AnalyticsRoot } from "./analytics/AnalyticsRoot.tsx";
import { DeviceCheck } from "./onboarding/DeviceCheck.tsx";
import { DeviceCheckGate } from "./onboarding/DeviceCheckGate.tsx";
import { AuthProvider, RequireAuth } from "./auth/AuthProvider.tsx";
import { SignIn } from "./auth/SignIn.tsx";

export default function App() {
  return (
    <BrowserRouter>
      <AnalyticsRoot />
      <RoomProvider><AuthProvider>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/signin" element={<SignIn />} />
          <Route path="/play" element={<RequireAuth><ModeSelect /></RequireAuth>} />
          <Route path="/play/:mode" element={<RequireAuth><DeviceCheckGate><Play /></DeviceCheckGate></RequireAuth>} />
          <Route path="/check" element={<DeviceCheck />} />
          <Route path="/training" element={<RequireAuth><Training /></RequireAuth>} />
          {import.meta.env.DEV ? (
            <Route path="/results-preview" element={<ResultsPreview />} />
          ) : null}
          <Route path="/sync" element={<SyncLyrics />} />
          <Route path="/pitchtest" element={<PitchTest />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="/stats" element={<ArenaStats />} />
          <Route path="/room/:code" element={<RequireAuth><DeviceCheckGate><Stage /></DeviceCheckGate></RequireAuth>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider></RoomProvider>
    </BrowserRouter>
  );
}
