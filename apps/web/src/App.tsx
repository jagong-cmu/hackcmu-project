/**
 * Thin router only. Do not put logic here (TECHNICAL_PRD §4).
 *
 * LANE B: swap `DevLanding` for your `home/Home.tsx` and add `/training`,
 * `/results`, `/leaderboard` as sibling <Route> lines. Nothing else.
 */
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { RoomProvider } from "./rooms/RoomProvider.tsx";
import DevLanding from "./rooms/DevLanding.tsx";
import Stage from "./stage/Stage.tsx";

export default function App() {
  return (
    <BrowserRouter>
      <RoomProvider>
        <Routes>
          <Route path="/" element={<DevLanding />} />
          <Route path="/room/:code" element={<Stage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </RoomProvider>
    </BrowserRouter>
  );
}
