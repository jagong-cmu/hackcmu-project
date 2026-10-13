import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Navigate, useLocation } from "react-router-dom";
import type { User } from "@supabase/supabase-js";
import { useRoom } from "../rooms/RoomProvider.tsx";
import { resyncSocketAuth, setLatestAccessToken } from "../rooms/socket.ts";
import { identifyPlayer } from "../analytics/posthog.ts";
import { PageShell } from "../theme/PageShell.tsx";
import {
  effectiveOnboarding,
  queuePatch,
  readMirror,
  syncFromAccount,
} from "../onboarding/accountOnboarding.ts";
import {
  EmptyOnboarding,
  fromMetadata,
  needsOnboarding as accountNeedsOnboarding,
  toMetadata,
  type OnboardingPatch,
  type OnboardingState,
} from "../onboarding/onboardingState.ts";
import type { VoiceProfile } from "../scoring/voiceRange.ts";
import { bindAccount, nameFromUser, safeNext, unbindAccount } from "./account.ts";
import type { ClientAuthMode } from "./authMode.ts";
import { authMode, getSupabase } from "./supabase.ts";
import "./auth.css";

export type AuthContextValue = {
  /** "accounts" normally; "unconfigured" fails closed; "dev-guest" is local dev only. */
  mode: ClientAuthMode;
  /** False until the stored session (or an OAuth `?code=`) has been read. */
  ready: boolean;
  /** True when Google accounts are on (mode === "accounts"). */
  configured: boolean;
  user: User | null;
  /**
   * True once the account record was re-read from Supabase this page load (or
   * that failed / timed out). Onboarding decisions wait for it so a stale
   * stored session never re-runs onboarding another device already finished.
   */
  accountFresh: boolean;
  /** This account's onboarding record (account metadata + unsent local writes). */
  onboarding: OnboardingState;
  needsOnboarding: boolean;
  /** Save an onboarding result: applied locally at once, written to the account in the background. */
  saveOnboarding: (patch: OnboardingPatch) => void;
  /**
   * Fallback flow: redirects to Google via Supabase's callback, comes back to
   * /signin, then on to `next`. Returns an error message, or null on success.
   */
  signInWithGoogle: (next: string) => Promise<string | null>;
  /**
   * Preferred flow: exchange a Google Identity Services ID token (minted on
   * our own origin) for a Supabase session. `rawNonce` is the unhashed nonce
   * whose SHA-256 was given to GIS. Returns an error message, or null.
   */
  signInWithGoogleIdToken: (idToken: string, rawNonce: string) => Promise<string | null>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const NEXT_KEY = "karaoke.authNext";
/** Retry a failed metadata write this often (also on `online` and next load). */
const RETRY_MS = 30_000;
/** Give up waiting on a fresh account read after this; fall back to the stored copy. */
const FRESH_TIMEOUT_MS = 4_000;

/** Where /signin should send the user once the Google round trip is done. */
export function peekAuthNext(): string | null {
  try {
    return sessionStorage.getItem(NEXT_KEY);
  } catch {
    return null;
  }
}

export function clearAuthNext(): void {
  try {
    sessionStorage.removeItem(NEXT_KEY);
  } catch {
    /* ignore */
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { hello } = useRoom();
  const configured = authMode === "accounts";
  const [ready, setReady] = useState(!configured);
  const [user, setUser] = useState<User | null>(null);
  const [freshFor, setFreshFor] = useState<string | null>(null);
  const [mirrorVersion, setMirrorVersion] = useState(0);
  const boundRef = useRef<string | null>(null);
  const userRef = useRef<User | null>(null);
  userRef.current = user;

  const bump = useCallback(() => setMirrorVersion((v) => v + 1), []);

  const apply = useCallback(
    (next: User | null) => {
      setUser(next);
      const id = next?.id ?? null;
      if (next) {
        // Display name can change (Settings) without the user id changing.
        const name = nameFromUser(next);
        if (id !== boundRef.current) bindAccount(next.id);
        boundRef.current = id;
        resyncSocketAuth(id);
        hello(name);
        identifyPlayer();
      } else if (boundRef.current) {
        boundRef.current = null;
        unbindAccount();
        resyncSocketAuth(null);
      }
    },
    [hello],
  );

  // --- account metadata writes (onboarding), retried until they land -------
  const flushingRef = useRef(false);
  const retryRef = useRef<number | null>(null);
  const flushRef = useRef<() => Promise<void>>(async () => {});

  const scheduleFlush = useCallback((ms: number) => {
    if (retryRef.current != null) window.clearTimeout(retryRef.current);
    retryRef.current = window.setTimeout(() => {
      retryRef.current = null;
      void flushRef.current();
    }, ms);
  }, []);

  flushRef.current = async () => {
    const sb = getSupabase();
    const uid = userRef.current?.id;
    if (!sb || !uid || flushingRef.current) return;
    const { pending } = readMirror(uid);
    if (!pending || Object.keys(pending).length === 0) return;
    flushingRef.current = true;
    try {
      const { data, error } = await sb.auth.updateUser({ data: toMetadata(pending) });
      if (error || !data.user) throw error ?? new Error("updateUser returned no user");
      if (data.user.id !== uid) return;
      syncFromAccount(uid, fromMetadata(data.user.user_metadata), pending);
      bump();
      // More results queued while this write was in flight.
      if (readMirror(uid).pending) scheduleFlush(0);
    } catch {
      // Offline or Supabase hiccup: the local mirror already lets them play.
      scheduleFlush(RETRY_MS);
    } finally {
      flushingRef.current = false;
    }
  };

  useEffect(() => {
    const onOnline = () => void flushRef.current();
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("online", onOnline);
      if (retryRef.current != null) window.clearTimeout(retryRef.current);
    };
  }, []);

  // Keep the per-user mirror in step with the account; send anything unsent.
  useEffect(() => {
    if (!user) return;
    syncFromAccount(user.id, fromMetadata(user.user_metadata));
    bump();
    void flushRef.current();
  }, [user, bump]);

  // --- session ---------------------------------------------------------------
  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    let cancelled = false;

    void sb.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setLatestAccessToken(data.session?.access_token ?? null);
      const stored = data.session?.user ?? null;
      apply(stored);
      setReady(true);
      if (!stored) return;
      // The stored session's user_metadata can be stale (onboarded on another
      // device since). Re-read it once; never wait on it forever.
      const timeout = new Promise<null>((resolve) =>
        window.setTimeout(() => resolve(null), FRESH_TIMEOUT_MS),
      );
      const fresh = sb.auth
        .getUser()
        .then(({ data: got }) => got.user ?? null)
        .catch(() => null);
      void Promise.race([fresh, timeout]).then((got) => {
        if (cancelled) return;
        if (got && got.id === stored.id && boundRef.current === stored.id) setUser(got);
        setFreshFor(stored.id);
      });
    });

    const { data: sub } = sb.auth.onAuthStateChange((event, session) => {
      // Every change, refreshes included: the next player:hello carries it.
      setLatestAccessToken(session?.access_token ?? null);
      // INITIAL_SESSION is covered by getSession above; TOKEN_REFRESHED keeps
      // the same user and the socket re-reads the token on reconnect.
      if (event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED") return;
      // Supabase holds a lock inside this callback; defer our own calls.
      window.setTimeout(() => {
        if (cancelled) return;
        const next = session?.user ?? null;
        apply(next);
        // A fresh sign-in or a metadata write hands us the server's copy.
        if (next && (event === "SIGNED_IN" || event === "USER_UPDATED")) setFreshFor(next.id);
      }, 0);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [apply]);

  const signInWithGoogle = useCallback(async (next: string) => {
    const sb = getSupabase();
    if (!sb) return "Accounts are not configured.";
    try {
      sessionStorage.setItem(NEXT_KEY, safeNext(next));
    } catch {
      /* fall back to Home after sign-in */
    }
    const { error } = await sb.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/signin`,
        queryParams: { prompt: "select_account" },
      },
    });
    return error ? error.message || "Could not start Google sign-in." : null;
  }, []);

  const signInWithGoogleIdToken = useCallback(async (idToken: string, rawNonce: string) => {
    const sb = getSupabase();
    if (!sb) return "Accounts are not configured.";
    try {
      const { error } = await sb.auth.signInWithIdToken({
        provider: "google",
        token: idToken,
        nonce: rawNonce,
      });
      return error ? error.message || "Google sign-in failed." : null;
    } catch (err) {
      return err instanceof Error && err.message ? err.message : "Google sign-in failed.";
    }
  }, []);

  const signOut = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) return;
    // Local: signing out here must not end this account's sessions on other
    // devices (the default "global" scope revokes every refresh token).
    await sb.auth.signOut({ scope: "local" });
  }, []);

  // --- onboarding --------------------------------------------------------------
  // Dev guests have no account; their record lives under a local "guest" key.
  const onboardingUid = user?.id ?? (authMode === "dev-guest" ? "guest" : null);
  const accountFresh = !configured || (user != null && freshFor === user.id);

  const onboarding = useMemo(() => {
    void mirrorVersion; // re-read the mirror after local writes
    if (!onboardingUid) return EmptyOnboarding;
    const account = user ? fromMetadata(user.user_metadata) : null;
    return effectiveOnboarding(account, readMirror(onboardingUid));
  }, [onboardingUid, user, mirrorVersion]);

  const saveOnboarding = useCallback(
    (patch: OnboardingPatch) => {
      if (!onboardingUid || Object.keys(patch).length === 0) return;
      queuePatch(onboardingUid, patch);
      bump();
      void flushRef.current();
    },
    [onboardingUid, bump],
  );

  const value = useMemo(
    () => ({
      mode: authMode,
      ready,
      configured,
      user,
      accountFresh,
      onboarding,
      needsOnboarding: accountNeedsOnboarding(onboarding),
      saveOnboarding,
      signInWithGoogle,
      signInWithGoogleIdToken,
      signOut,
    }),
    [
      ready,
      configured,
      user,
      accountFresh,
      onboarding,
      saveOnboarding,
      signInWithGoogle,
      signInWithGoogleIdToken,
      signOut,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

/**
 * The signed-in account's voice range (for the live pitch line), or null.
 * Value-stable: the same object until the numbers change, so PitchMeter does
 * not re-seed mid-song when unrelated account fields update.
 */
export function useVoiceProfile(): VoiceProfile | null {
  const profile = useAuth().onboarding.voiceProfile;
  const ref = useRef<VoiceProfile | null>(profile);
  const same =
    ref.current === profile ||
    (ref.current != null &&
      profile != null &&
      ref.current.lowMidi === profile.lowMidi &&
      ref.current.highMidi === profile.highMidi &&
      ref.current.centerMidi === profile.centerMidi &&
      ref.current.measuredAt === profile.measuredAt);
  if (!same) ref.current = profile;
  return ref.current;
}

/** Shown on every play route when the build has no Supabase config. */
export function AccountsUnavailable() {
  return (
    <PageShell title="Accounts aren't configured" tag="Playing needs a Google account.">
      <div className="auth-card">
        <p className="dim auth-note" role="alert">
          Accounts aren't configured on this site, so matches and Training are off. The
          leaderboard and stats are still open.
        </p>
      </div>
    </PageShell>
  );
}

/**
 * Anything that plays (matches, Training, the onboarding checks). Signed-out
 * visitors go sign in first; with no Supabase config, nobody plays.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { mode, ready, user } = useAuth();
  const location = useLocation();
  if (mode === "dev-guest") return children;
  if (mode === "unconfigured") return <AccountsUnavailable />;
  if (!ready) {
    return (
      <main className="page bloom-page shell">
        <p className="dim auth-wait">Checking your session…</p>
      </main>
    );
  }
  if (!user) {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/signin?next=${encodeURIComponent(next)}`} replace />;
  }
  return children;
}
