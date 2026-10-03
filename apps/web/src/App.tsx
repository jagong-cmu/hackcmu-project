/**
 * Thin router only. Do not put logic here (TECHNICAL_PRD §4).
 */
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Home } from "./home/Home.tsx";
import { Play } from "./home/Play.tsx";
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

export default function App() {
  return (
    <BrowserRouter>
      <AnalyticsRoot />
      <RoomProvider>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/play/:mode" element={<Play />} />
          <Route path="/training" element={<Training />} />
          {import.meta.env.DEV ? (
            <Route path="/results-preview" element={<ResultsPreview />} />
          ) : null}
          <Route path="/sync" element={<SyncLyrics />} />
          <Route path="/pitchtest" element={<PitchTest />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="/stats" element={<ArenaStats />} />
          <Route path="/room/:code" element={<Stage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </RoomProvider>
    </BrowserRouter>
  );
}
