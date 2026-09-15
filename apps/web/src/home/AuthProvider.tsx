import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Navigate, useLocation } from "react-router-dom";
import type { User } from "@supabase/supabase-js";
import { useRoom } from "../rooms/RoomProvider.tsx";
import { bindAccount, getDisplayName, unbindAccount, validName } from "./identity.ts";
import { authConfigured, getSupabase } from "./supabase.ts";

export type AuthContextValue = {
  ready: boolean;
  configured: boolean;
  user: User | null;
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (email: string, password: string, displayName: string) => Promise<string | null>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function nameFromUser(user: User): string {
  const meta = user.user_metadata?.display_name;
  if (typeof meta === "string" && validName(meta)) return meta.trim().slice(0, 16);
  const local = getDisplayName();
  if (validName(local)) return local;
  const fromEmail = user.email?.split("@")[0]?.slice(0, 16) ?? "";
  if (validName(fromEmail)) return fromEmail;
  return "Singer";
}

function friendlyAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login")) return "Email or password is wrong.";
  if (m.includes("already registered") || m.includes("already been registered")) {
    return "That email already has an account.";
  }
  if (m.includes("password")) return "Password needs at least 8 characters.";
  if (m.includes("rate limit") || m.includes("too many")) return "Too many tries. Wait a minute.";
  if (m.includes("invalid email") || m.includes("email")) return "That email does not look right.";
  return message || "Could not sign in.";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { hello } = useRoom();
  const configured = authConfigured();
  const [ready, setReady] = useState(!configured);
  const [user, setUser] = useState<User | null>(null);

  const applyUser = useCallback(
    (next: User) => {
      const name = nameFromUser(next);
      bindAccount(next.id, name);
      hello(name);
    },
    [hello],
  );

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) {
      setReady(true);
      return;
    }

    let cancelled = false;
    void sb.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      const next = data.session?.user ?? null;
      setUser(next);
      if (next) applyUser(next);
      setReady(true);
    });

    const { data: sub } = sb.auth.onAuthStateChange((event, session) => {
      const next = session?.user ?? null;
      setUser(next);
      if (next) applyUser(next);
      else if (event === "SIGNED_OUT") {
        unbindAccount();
        hello(getDisplayName() || "Singer");
      }
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [applyUser, hello]);

  const signIn = useCallback(async (email: string, password: string) => {
    const sb = getSupabase();
    if (!sb) return "Accounts are not configured.";
    const { error } = await sb.auth.signInWithPassword({ email, password });
    return error ? friendlyAuthError(error.message) : null;
  }, []);

  const signUp = useCallback(async (email: string, password: string, displayName: string) => {
    const sb = getSupabase();
    if (!sb) return "Accounts are not configured.";
    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName.trim().slice(0, 16) } },
    });
    if (error) return friendlyAuthError(error.message);
    if (!data.session) return "Check your email to finish creating the account.";
    return null;
  }, []);

  const signOut = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) return;
    await sb.auth.signOut();
  }, []);

  const value = useMemo(
    () => ({ ready, configured, user, signIn, signUp, signOut }),
    [ready, configured, user, signIn, signUp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { configured, ready, user } = useAuth();
  const location = useLocation();
  if (!configured) return children;
  if (!ready) return null;
  if (!user) return <Navigate to="/" replace state={{ from: location.pathname }} />;
  return children;
}
