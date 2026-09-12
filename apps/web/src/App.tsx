import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { Home, WaitingForLaneA } from "./home/Home.tsx";
import { Play } from "./home/Play.tsx";
import { Settings } from "./home/Settings.tsx";
import { Leaderboard } from "./leaderboard/Leaderboard.tsx";
import { Training } from "./training/Training.tsx";

export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/play/:mode" element={<Play />} />
        <Route path="/training" element={<Training />} />
        <Route path="/leaderboard" element={<Leaderboard />} />
        <Route path="/waiting" element={<WaitingForLaneA />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  );
}
