import { useEffect, useMemo, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { PageShell } from "../theme/PageShell.tsx";
import { AccountsUnavailable, clearAuthNext, peekAuthNext, useAuth } from "./AuthProvider.tsx";
import { postSignInPath } from "../onboarding/onboardingState.ts";
import { GoogleButton } from "./GoogleButton.tsx";
import { safeNext } from "./account.ts";
import { SignInAgreement } from "../legal/LegalLinks.tsx";
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
 * The Google Identity Services button signs in without leaving this page;
 * the fallback redirect flow (GoogleButton.tsx) lands back here with
 * `?code=`, supabase-js swaps it for a session, and we move on to `next` —
 * through onboarding first (/check, then /check/voice) if this account has
 * never done it.
 */
export function SignIn() {
  const { mode, ready, user, accountFresh, onboarding } = useAuth();
  const [params] = useSearchParams();
  const queryNext = params.get("next");
  const returning = params.has("code");
  const urlError = useMemo(() => redirectError(params), [params]);
  // Where to go after sign-in: the explicit ?next, else what we stashed before
  // leaving for Google.
  const next = safeNext(queryNext ?? peekAuthNext());
  const signedIn = ready && Boolean(user);
  const done = mode === "dev-guest" || (signedIn && accountFresh);

  useEffect(() => {
    if (done) clearAuthNext();
  }, [done]);

  if (mode === "dev-guest") return <Navigate to={next} replace />;
  if (mode === "unconfigured") return <AccountsUnavailable />;
  // A brand-new account goes through onboarding once, then on to `next`.
  if (done) return <Navigate to={postSignInPath(onboarding, next)} replace />;

  return (
    <PageShell title="Sign in" tag="Sign in to play. Your ELO follows your account.">
      <div className="auth-card">
        {!ready || signedIn || (returning && !urlError) ? (
          <p className="dim">{returning || signedIn ? "Signing you in…" : "Checking your session…"}</p>
        ) : (
          <>
            <GoogleButton next={next} oneTap />
            {urlError ? <p className="err">{urlError}</p> : null}
            <p className="dim auth-note">
              Leaderboard and stats are open to everyone. Matches need an account so
              nobody else can play under your name.
            </p>
            <SignInAgreement />
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
