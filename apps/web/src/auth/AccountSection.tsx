import { useNavigate } from "react-router-dom";
import { useAuth } from "./AuthProvider.tsx";
import { GoogleButton } from "./GoogleButton.tsx";
import "./auth.css";

/** Settings block: who you are signed in as, and the way out. */
export function AccountSection() {
  const navigate = useNavigate();
  const { configured, ready, user, signOut } = useAuth();
  if (!configured || !ready) return null;

  if (!user) {
    return (
      <section className="settings-account">
        <p className="dim">Sign in to play matches and keep your ELO.</p>
        <GoogleButton next="/settings" ghost />
      </section>
    );
  }

  return (
    <section className="settings-account">
      <p className="dim">Signed in as {user.email ?? "your Google account"}</p>
      <button
        type="button"
        className="cta cta-ghost"
        onClick={() => {
          void signOut().then(() => navigate("/"));
        }}
      >
        Sign out
      </button>
    </section>
  );
}
