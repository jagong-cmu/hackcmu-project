import { useEffect, useMemo, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { PageShell } from "../theme/PageShell.tsx";
import { clearAuthNext, peekAuthNext, useAuth } from "./AuthProvider.tsx";
import { GoogleButton } from "./GoogleButton.tsx";
import { safeNext } from "./account.ts";
import "./auth.css";

/** Error Google / Supabase put on the redirect back, in the query or hash. */
function redirectError(params: URLSearchParams): string | null {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const raw =
    params.get("error_description") ||
    hash.get("error_description") ||
    params.get("error") ||
    hash.get("error");
  return raw ? raw.replace(/\+/g, " ") : null;
}

/**
 * /signin — the gate in front of Play, matches, and private-room links.
 * Also the OAuth redirect target: Google sends the browser back here with
 * `?code=`, supabase-js swaps it for a session, and we move on to `next`.
 */
export function SignIn() {
  const { configured, ready, user } = useAuth();
  const [params] = useSearchParams();
  const queryNext = params.get("next");
  const returning = params.has("code");
  const urlError = useMemo(() => redirectError(params), [params]);
  // Where to go after sign-in: the explicit ?next, else what we stashed before
  // leaving for Google.
  const next = safeNext(queryNext ?? peekAuthNext());
  const done = !configured || (ready && Boolean(user));

  useEffect(() => {
    if (done) clearAuthNext();
  }, [done]);

  if (!configured) return <Navigate to={next} replace />;
  if (ready && user) return <Navigate to={next} replace />;

  return (
    <PageShell title="Sign in" tag="Sign in to play. Your ELO follows your account.">
      <div className="auth-card">
        {!ready || (returning && !urlError) ? (
          <p className="dim">{returning ? "Signing you in…" : "Checking your session…"}</p>
        ) : (
          <>
            <GoogleButton next={next} />
            {urlError ? <p className="err">{urlError}</p> : null}
            <p className="dim auth-note">
              Leaderboard and stats are open to everyone. Matches need an account so
              nobody else can play under your name.
            </p>
          </>
        )}
        {returning && ready && !user && !urlError ? <StuckHint /> : null}
      </div>
    </PageShell>
  );
}

/** If the code exchange silently failed, do not leave them on a spinner. */
function StuckHint() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setShow(true), 4000);
    return () => window.clearTimeout(id);
  }, []);
  if (!show) return null;
  return (
    <p className="dim">
      That took too long. <a href="/signin">Try again</a>.
    </p>
  );
}
