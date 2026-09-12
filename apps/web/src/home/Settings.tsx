import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { getClientId, getDisplayName, setDisplayName, validName } from "./identity.ts";
import { ThemeToggle } from "../theme/ThemeToggle.tsx";
import { useRoom } from "../rooms/RoomProvider.tsx";

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
    const saved = setDisplayName(name);
    hello(saved);
    try {
      await fetch("/api/player/hello", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: getClientId(), displayName: saved }),
      });
    } catch {
      /* still continue */
    }
    navigate(next);
  }

  return (
    <main className="page quiet">
      <Link to="/" className="back">
        Home
      </Link>
      <ThemeToggle />
      <h1>Settings</h1>
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
        <button type="submit" className="btn gold">
          Save
        </button>
      </form>
      <p className="dim">
        {mongo == null ? "Checking Atlas…" : mongo ? "Atlas connected" : "Atlas is off until the database password is in server/.env"}
      </p>
    </main>
  );
}
