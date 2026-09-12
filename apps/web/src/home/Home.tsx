import { Link, useNavigate } from "react-router-dom";
import { AriaOrb } from "../theme/AriaOrb.tsx";
import { ThemeToggle } from "../theme/ThemeToggle.tsx";
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
    <main className="home-simple">
      <header className="home-top">
        <p className="wordmark">Aria</p>
        <nav>
          <Link to="/settings">Settings</Link>
          <Link to="/leaderboard">Board</Link>
          <ThemeToggle />
        </nav>
      </header>

      <div className="home-hero">
        <div className="modes">
          {MODES.map((mode) => (
            <button
              key={mode.to}
              type="button"
              onClick={() => navigate(named ? mode.to : `/settings?next=${mode.to}`)}
            >
              {mode.label}
            </button>
          ))}
        </div>
        <AriaOrb size={320} className="home-orb" />
      </div>
    </main>
  );
}
