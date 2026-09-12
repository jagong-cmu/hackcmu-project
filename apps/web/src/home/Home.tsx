import { Link, useNavigate } from "react-router-dom";
import { AriaOrb } from "../theme/AriaOrb.tsx";
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
      <div className="bloom" aria-hidden="true">
        <div className="bloom-core" />
      </div>

      <header className="home-top">
        <p className="wordmark">
          <AriaOrb size={22} idle className="mark" />
          Aria
        </p>
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
            <button
              key={mode.to}
              type="button"
              onClick={() => navigate(named ? mode.to : `/settings?next=${mode.to}`)}
            >
              {mode.label}
            </button>
          ))}
        </div>
        <p className="home-sub">
          Your pitch is scored by DSP, not vibes. Headphones recommended.
        </p>
      </div>
    </main>
  );
}
