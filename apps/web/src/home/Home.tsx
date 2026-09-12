import { Link, useNavigate } from "react-router-dom";
import { getDisplayName } from "./identity.ts";

export function Home() {
  const navigate = useNavigate();
  const named = getDisplayName().trim().length >= 2;

  return (
    <main className="home-simple">
      <header className="home-top">
        <p className="wordmark">Karaoke Arena</p>
        <nav>
          <Link to="/settings">Settings</Link>
          <Link to="/leaderboard">Board</Link>
        </nav>
      </header>

      <div className="modes">
        <button type="button" onClick={() => navigate(named ? "/play/ranked" : "/settings?next=/play/ranked")}>
          Ranked
        </button>
        <button type="button" onClick={() => navigate(named ? "/play/duet" : "/settings?next=/play/duet")}>
          Duet
        </button>
        <button type="button" onClick={() => navigate(named ? "/training" : "/settings?next=/training")}>
          Training
        </button>
        <button type="button" onClick={() => navigate(named ? "/play/chaos" : "/settings?next=/play/chaos")}>
          Chaos
        </button>
      </div>
    </main>
  );
}

export function WaitingForLaneA() {
  const q = new URLSearchParams(window.location.hash.split("?")[1] || "");
  return (
    <main className="page quiet">
      <Link to="/" className="back">
        Home
      </Link>
      <h1>Lobby next</h1>
      <p>
        Mode <strong>{q.get("mode") || "?"}</strong>
        {q.get("code") ? <> · code {q.get("code")}</> : null}
        {q.get("action") ? <> · {q.get("action")}</> : null}
      </p>
      <p className="dim">
        Lane A owns LiveKit and matchmaking. Training does not wait on that.
      </p>
    </main>
  );
}
