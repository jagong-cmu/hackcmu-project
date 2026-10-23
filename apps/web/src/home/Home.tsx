import { Link, useNavigate } from "react-router-dom";
import { Bloom } from "../theme/Bloom.tsx";
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
      <Bloom />

      <nav className="home-nav">
        <Link to="/settings">Settings</Link>
        <Link to="/leaderboard">Board</Link>
        <Link to="/stats">Stats</Link>
      </nav>

      <div className="home-hero">
        <h1 className="wordmark">Aria</h1>
        <p className="home-pitch">1v1 karaoke. Same chorus. They watch you.</p>

        <div className="home-go">
          <button type="button" className="btn btn-primary btn-lg" onClick={play}>
            Play
          </button>
          {signedOut || mode === "unconfigured" ? (
            <p className="home-go-hint">
              {signedOut ? "Sign in with Google to sing" : "Accounts aren't configured"}
            </p>
          ) : null}
          <Link className="home-code-link" to={signedOut ? "/signin?next=%2Fplay%2Franked" : "/play/ranked"}>
            Have a room code?
          </Link>
        </div>
      </div>

      <footer className="home-legal">
        <LegalLinks />
      </footer>
    </main>
  );
}
