import { useState, type FormEvent } from "react";
import { validName } from "./identity.ts";
import { useAuth } from "./AuthProvider.tsx";

type Mode = "signup" | "signin";

export function AuthPanel() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<Mode>("signup");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (mode === "signup" && !validName(name)) {
      setMsg("Name needs 2–16 characters.");
      return;
    }
    if (!email.trim() || !password) {
      setMsg("Email and password are required.");
      return;
    }
    setBusy(true);
    setMsg("");
    const err =
      mode === "signup"
        ? await signUp(email.trim(), password, name)
        : await signIn(email.trim(), password);
    setBusy(false);
    if (err) setMsg(err);
  }

  return (
    <form className="home-auth" onSubmit={(e) => void submit(e)}>
      <div className="tabs" role="tablist" aria-label="Account">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "signup"}
          className={mode === "signup" ? "on" : undefined}
          onClick={() => {
            setMode("signup");
            setMsg("");
          }}
        >
          Create account
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "signin"}
          className={mode === "signin" ? "on" : undefined}
          onClick={() => {
            setMode("signin");
            setMsg("");
          }}
        >
          Sign in
        </button>
      </div>

      {mode === "signup" ? (
        <label>
          Display name
          <input
            value={name}
            maxLength={16}
            autoComplete="nickname"
            autoFocus
            placeholder="2–16 characters"
            onChange={(e) => {
              setName(e.target.value);
              if (msg) setMsg("");
            }}
          />
        </label>
      ) : null}

      <label>
        Email
        <input
          type="email"
          value={email}
          autoComplete="email"
          autoFocus={mode === "signin"}
          placeholder="you@school.edu"
          onChange={(e) => {
            setEmail(e.target.value);
            if (msg) setMsg("");
          }}
        />
      </label>
      <label>
        Password
        <input
          type="password"
          value={password}
          minLength={8}
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          placeholder="at least 8 characters"
          onChange={(e) => {
            setPassword(e.target.value);
            if (msg) setMsg("");
          }}
        />
      </label>

      {msg ? (
        <p className={msg.startsWith("Check your email") ? "dim" : "err home-name-err"}>{msg}</p>
      ) : null}

      <button type="submit" className="cta" disabled={busy}>
        {busy ? "Working…" : mode === "signup" ? "Create account" : "Sign in"}
      </button>
    </form>
  );
}
