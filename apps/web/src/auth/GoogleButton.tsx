import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthProvider.tsx";
import { safeNext } from "./account.ts";
import { loadGis, type GisAccountsId, type GisCredentialResponse } from "./gis.ts";
import { createNoncePair } from "./nonce.ts";
import { initialGisStatus, selectSignInFlow, type GisStatus } from "./signInFlow.ts";
import "./auth.css";

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() ?? "";
/** If Google's button hasn't drawn by now (blocked origin, blocked iframe), fall back. */
const RENDER_CHECK_MS = 3500;

/**
 * "Continue with Google".
 *
 * Preferred: Google Identity Services' own button, on our origin, so Google's
 * sign-in shows Aria / karaoke-arena.vercel.app instead of the Supabase
 * project domain. The ID token it returns is exchanged with
 * supabase.auth.signInWithIdToken (nonce-bound), without leaving the page.
 *
 * Fallback (no VITE_GOOGLE_CLIENT_ID, script blocked or slow, button never
 * draws, or the user asks): the Supabase redirect flow, which round-trips
 * through Google and back to /signin. Either way the user ends on /signin,
 * which sends new accounts through onboarding and everyone else to `next`.
 */
export function GoogleButton({
  next,
  ghost,
  oneTap,
}: {
  next: string;
  ghost?: boolean;
  /** Also offer Google One Tap (sign-in page only). */
  oneTap?: boolean;
}) {
  const { signInWithGoogleIdToken } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [status, setStatus] = useState<GisStatus>(() => initialGisStatus(CLIENT_ID));
  const [forceRedirect, setForceRedirect] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const holderRef = useRef<HTMLDivElement>(null);
  const gisRef = useRef<GisAccountsId | null>(null);
  const nonceRef = useRef<string | null>(null);
  const flow = selectSignInFlow({ clientId: CLIENT_ID, status, forceRedirect });

  // Kept current for GIS's callback, which is registered once per initialize.
  const onCredentialRef = useRef<(r: GisCredentialResponse) => void>(() => {});
  onCredentialRef.current = (response) => {
    const raw = nonceRef.current;
    if (!response.credential || !raw) {
      setMsg("Google didn't return a sign-in. Try again.");
      return;
    }
    setBusy(true);
    setMsg("");
    void signInWithGoogleIdToken(response.credential, raw).then((err) => {
      if (err) {
        setBusy(false);
        setMsg(err);
        void initialize(); // fresh nonce for the next try
        return;
      }
      // /signin finishes the job: onboarding for new accounts, else `next`.
      if (location.pathname !== "/signin") {
        navigate(`/signin?next=${encodeURIComponent(safeNext(next))}`, { replace: true });
      }
    });
  };

  const initialize = useCallback(async () => {
    const id = gisRef.current;
    if (!id) return;
    const { raw, hashed } = await createNoncePair();
    nonceRef.current = raw;
    id.initialize({
      client_id: CLIENT_ID,
      nonce: hashed,
      callback: (r) => onCredentialRef.current(r),
      ux_mode: "popup",
      context: "signin",
      auto_select: false,
      cancel_on_tap_outside: true,
      itp_support: true,
      use_fedcm_for_prompt: true,
    });
  }, []);

  // Load GIS (only when this button is on screen) and initialise it.
  useEffect(() => {
    if (status !== "loading") return;
    let cancelled = false;
    loadGis()
      .then(async (id) => {
        if (cancelled) return;
        gisRef.current = id;
        await initialize();
        if (!cancelled) setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [status, initialize]);

  // Draw Google's button; fall back if it never appears.
  useEffect(() => {
    const id = gisRef.current;
    const holder = holderRef.current;
    if (flow !== "gis" || !id || !holder) return;
    const width = Math.max(200, Math.min(400, Math.round(holder.clientWidth || 320)));
    try {
      id.renderButton(holder, {
        type: "standard",
        theme: "filled_black",
        size: "large",
        text: "continue_with",
        shape: "pill",
        logo_alignment: "left",
        width,
      });
    } catch {
      setStatus("failed");
      return;
    }
    if (oneTap) {
      try {
        id.prompt();
      } catch {
        /* One Tap is a bonus; the button is the path */
      }
    }
    const timer = window.setTimeout(() => {
      const frame = holder.querySelector("iframe");
      const drawn = frame != null && frame.getBoundingClientRect().height > 0;
      if (!drawn) setStatus("failed");
    }, RENDER_CHECK_MS);
    return () => {
      window.clearTimeout(timer);
      if (oneTap) {
        try {
          id.cancel();
        } catch {
          /* ignore */
        }
      }
    };
  }, [flow, oneTap]);

  if (flow === "redirect") {
    return <RedirectButton next={next} ghost={ghost} />;
  }

  return (
    <div className="gis-wrap">
      {busy ? <p className="dim gis-busy">Signing you in…</p> : null}
      {/* Stays mounted while busy: Google's button lives inside it. */}
      <div
        ref={holderRef}
        className={flow === "pending" ? "gis-holder gis-pending" : "gis-holder"}
        aria-busy={flow === "pending"}
        hidden={busy}
      >
        {flow === "pending" ? <span className="dim">Loading Google sign-in…</span> : null}
      </div>
      {msg ? <p className="err">{msg}</p> : null}
      {!busy ? (
        <button type="button" className="gis-alt" onClick={() => setForceRedirect(true)}>
          Button not working? Sign in another way
        </button>
      ) : null}
    </div>
  );
}

/** The Supabase redirect flow: leaves the page; Google returns to /signin. */
function RedirectButton({ next, ghost }: { next: string; ghost?: boolean }) {
  const { signInWithGoogle } = useAuth();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function go() {
    setBusy(true);
    setMsg("");
    const err = await signInWithGoogle(next);
    // On success the browser is already navigating away.
    if (err) {
      setMsg(err);
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className={ghost ? "cta cta-ghost google-btn" : "cta google-btn"}
        disabled={busy}
        onClick={() => void go()}
      >
        <svg aria-hidden="true" viewBox="0 0 48 48" width="18" height="18">
          <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
          <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
          <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
          <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
        </svg>
        {busy ? "Opening Google…" : "Continue with Google"}
      </button>
      {msg ? <p className="err">{msg}</p> : null}
    </>
  );
}
