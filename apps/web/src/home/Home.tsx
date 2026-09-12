import { Link, useNavigate } from "react-router-dom";
import { Bloom } from "../theme/Bloom.tsx";
import { ModeButton } from "./ModeButton.tsx";
import { getDisplayName } from "./identity.ts";

const MODES = [
  { label: "Ranked", to: "/play/ranked" },
  { label: "Duet", to: "/play/duet" },
  { label: "Training", to: "/training" },
  { label: "Chaos", to: "/play/chaos" },
];

export function Home() {
  const navigate = useNavigate();
  const named = getDisplayName().trim().length >= 2;

  return (
    <main className="home-simple bloom-page">
      <Bloom />

      <header className="home-top">
        <p className="wordmark">Aria</p>
        <nav>
          <Link to="/settings">Settings</Link>
          <Link to="/leaderboard">Board</Link>
        </nav>
      </header>

      <div className="home-hero">
        <p className="eyebrow">
          <span className="eyebrow-pill">Sing head to head</span>
        </p>
        <div className="modes">
          {MODES.map((mode) => (
            <ModeButton
              key={mode.to}
              label={mode.label}
              onSelect={() => navigate(named ? mode.to : `/settings?next=${mode.to}`)}
            />
          ))}
        </div>
      </div>
    </main>
  );
}
