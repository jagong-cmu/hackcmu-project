import { Link, useNavigate } from "react-router-dom";
import { VoiceWave } from "../theme/VoiceWave.tsx";
import { ModeButton } from "./ModeButton.tsx";
import { capture } from "../analytics/posthog.ts";
import { useAuth } from "../auth/AuthProvider.tsx";
import { LegalLinks } from "../legal/LegalLinks.tsx";

/**
 * Landing page. There is no guest name entry: playing needs a Google account,
 * and the display name comes from it (editable in Settings).
 */
export function Home() {
  const navigate = useNavigate();
  const { mode, user } = useAuth();
  const signedOut = mode === "accounts" && !user;

  function play() {
    if (signedOut) {
      capture("play pressed", { signedIn: false });
      navigate("/signin?next=%2Fplay");
      return;
    }
    capture("play pressed", {});
    // /play is behind RequireAuth: with no account config it explains why play is off.
    navigate("/play");
  }

  return (
    <main className="home-simple bloom-page">
      <VoiceWave />

      <nav className="home-nav">
        <Link to="/settings">Settings</Link>
        <Link to="/leaderboard">Board</Link>
        <Link to="/stats">Stats</Link>
      </nav>

      <div className="home-hero">
        <h1 className="wordmark">Aria</h1>
        <div className="hero-rule" aria-hidden="true">
          <span className="hero-rule-line" />
          <span className="hero-rule-dot" />
          <span className="hero-rule-line" />
        </div>
        <p className="home-pitch">1v1 karaoke. Same chorus. They watch you.</p>

        <div className="home-go">
          <div className="modes home-play">
            <ModeButton
              label="Play"
              hint={
                signedOut
                  ? "sign in with Google"
                  : mode === "unconfigured"
                    ? "accounts aren't configured"
                    : "pick a mode"
              }
              onSelect={play}
            />
          </div>
        </div>
      </div>

      <footer className="home-legal">
        <LegalLinks />
      </footer>
    </main>
  );
}
