import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { commitDisplayName, getDisplayName, validName } from "./identity.ts";
import { useRoom } from "../rooms/RoomProvider.tsx";
import { PageShell } from "../theme/PageShell.tsx";
import { identifyPlayer } from "../analytics/posthog.ts";
import { DeviceCheckLink } from "../onboarding/DeviceCheckGate.tsx";
import { AccountSection } from "../auth/AccountSection.tsx";
import { useAuth } from "../auth/AuthProvider.tsx";
import { LegalLinks } from "../legal/LegalLinks.tsx";
import { Button } from "../ui/Button.tsx";
import "./pages.css";
import { safeNextPath } from "../lib/safeNext.ts";

export function Settings() {
  const navigate = useNavigate();
  const { hello } = useRoom();
  const [params] = useSearchParams();
  const next = safeNextPath(params.get("next"), "/");
  const [name, setName] = useState(getDisplayName());
  const [mongo, setMongo] = useState<boolean | null>(null);
  const [msg, setMsg] = useState("");
  const { mode, user } = useAuth();
  // Names belong to accounts: nothing to edit until you are signed in.
  const canName = mode === "dev-guest" || (mode === "accounts" && Boolean(user));

  useEffect(() => {
    if (user) setName(getDisplayName());
  }, [user]);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((j) => setMongo(Boolean(j.mongo)))
      .catch(() => setMongo(false));
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!validName(name)) {
      setMsg("Name needs 2–16 characters.");
      return;
    }
    const saved = await commitDisplayName(name);
    hello(saved);
    identifyPlayer();
    navigate(next);
  }

  return (
    <PageShell title="Settings" tag="This is how other singers will see you." className="pg-page">
      <div className="pg">
        {canName ? (
          <form className="pg-group" onSubmit={(e) => void save(e)}>
            <h2 className="t-label">Profile</h2>
            <label className="pg-field">
              <span className="t-label">Display name</span>
              <input
                value={name}
                maxLength={16}
                autoComplete="nickname"
                autoFocus
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            {msg ? <p className="err">{msg}</p> : null}
            <Button type="submit" variant="primary">
              Save name
            </Button>
          </form>
        ) : null}
        <section className="pg-group">
          <h2 className="t-label">Account</h2>
          <AccountSection />
        </section>
        <section className="pg-group">
          <h2 className="t-label">Devices</h2>
          <DeviceCheckLink next="/settings" />
        </section>
        <section className="pg-group">
          <h2 className="t-label">Connection</h2>
          <p className="dim">
            {mongo == null ? "Checking connection…" : mongo ? "Ready." : "Can't reach the server right now."}
          </p>
        </section>
        <LegalLinks className="settings-legal" />
      </div>
    </PageShell>
  );
}
