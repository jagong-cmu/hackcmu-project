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
import { resyncSocketAuth } from "../rooms/socket.ts";
import { getDisplayName } from "../home/identity.ts";
import { identifyPlayer } from "../analytics/posthog.ts";
import { bindAccount, linkPendingRating, nameFromUser, safeNext, unbindAccount } from "./account.ts";
import { authConfigured, getSupabase } from "./supabase.ts";

export type AuthContextValue = {
  /** False until the stored session (or an OAuth `?code=`) has been read. */
  ready: boolean;
  /** False when VITE_SUPABASE_* are unset: accounts off, everyone plays. */
  configured: boolean;
  user: User | null;
  /** Redirects to Google; comes back to /signin, then on to `next`. */
  signInWithGoogle: (next: string) => Promise<string | null>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const NEXT_KEY = "karaoke.authNext";

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
  const configured = authConfigured();
  const [ready, setReady] = useState(!configured);
  const [user, setUser] = useState<User | null>(null);
  const boundRef = useRef<string | null>(null);

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
        void linkPendingRating().then((linked) => {
          // Re-hello so the server reloads the carried-over ELO.
          if (linked) hello(getDisplayName() || name);
        });
      } else if (boundRef.current) {
        boundRef.current = null;
        unbindAccount();
        resyncSocketAuth(null);
      }
    },
    [hello],
  );

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    let cancelled = false;

    void sb.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      apply(data.session?.user ?? null);
      setReady(true);
    });

    const { data: sub } = sb.auth.onAuthStateChange((event, session) => {
      // INITIAL_SESSION is covered by getSession above; TOKEN_REFRESHED keeps
      // the same user and the socket re-reads the token on reconnect.
      if (event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED") return;
      // Supabase holds a lock inside this callback; defer our own calls.
      window.setTimeout(() => {
        if (!cancelled) apply(session?.user ?? null);
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

  const signOut = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) return;
    await sb.auth.signOut();
  }, []);

  const value = useMemo(
    () => ({ ready, configured, user, signInWithGoogle, signOut }),
    [ready, configured, user, signInWithGoogle, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

/** Anything that reaches a real match. Signed-out visitors go sign in first. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { configured, ready, user } = useAuth();
  const location = useLocation();
  if (!configured) return children;
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
