import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { commitDisplayName, getDisplayName, validName } from "./identity.ts";
import { useRoom } from "../rooms/RoomProvider.tsx";
import { PageShell } from "../theme/PageShell.tsx";
import { identifyPlayer } from "../analytics/posthog.ts";

export function Settings() {
  const navigate = useNavigate();
  const { hello } = useRoom();
  const [params] = useSearchParams();
  const next = params.get("next") || "/";
  const [name, setName] = useState(getDisplayName());
  const [mongo, setMongo] = useState<boolean | null>(null);
  const [msg, setMsg] = useState("");

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
    <PageShell title="Settings" tag="This is how other singers will see you.">
      <form className="settings-form" onSubmit={(e) => void save(e)}>
        <label>
          Display name
          <input
            value={name}
            maxLength={16}
            autoComplete="nickname"
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {msg ? <p className="err">{msg}</p> : null}
        <button type="submit" className="cta">
          Save name
        </button>
      </form>
      <p className="dim">
        {mongo == null
          ? "Checking connection…"
          : mongo
            ? "Ready."
            : "Can't reach the server right now."}
      </p>
    </PageShell>
  );
}
