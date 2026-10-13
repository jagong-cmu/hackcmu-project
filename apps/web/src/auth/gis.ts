/**
 * Loads Google Identity Services (https://accounts.google.com/gsi/client) on
 * demand: only when a Google sign-in button mounts, never on the rest of the
 * app. One script tag per page; concurrent callers share the same promise.
 */

export type GisCredentialResponse = { credential?: string; select_by?: string };

export type GisInitConfig = {
  client_id: string;
  callback: (response: GisCredentialResponse) => void;
  nonce?: string;
  auto_select?: boolean;
  cancel_on_tap_outside?: boolean;
  context?: "signin" | "signup" | "use";
  ux_mode?: "popup" | "redirect";
  itp_support?: boolean;
  use_fedcm_for_prompt?: boolean;
  use_fedcm_for_button?: boolean;
};

export type GisButtonConfig = {
  type?: "standard" | "icon";
  theme?: "outline" | "filled_blue" | "filled_black";
  size?: "large" | "medium" | "small";
  text?: "signin_with" | "signup_with" | "continue_with" | "signin";
  shape?: "rectangular" | "pill" | "circle" | "square";
  logo_alignment?: "left" | "center";
  width?: number;
  locale?: string;
};

export type GisAccountsId = {
  initialize: (config: GisInitConfig) => void;
  renderButton: (parent: HTMLElement, options: GisButtonConfig) => void;
  prompt: () => void;
  cancel: () => void;
  disableAutoSelect: () => void;
};

declare global {
  interface Window {
    google?: { accounts?: { id?: GisAccountsId } };
  }
}

export const GIS_SRC = "https://accounts.google.com/gsi/client";
const LOAD_TIMEOUT_MS = 6000;

let loading: Promise<GisAccountsId> | null = null;

function ready(): GisAccountsId | null {
  return window.google?.accounts?.id ?? null;
}

/** Resolve with `google.accounts.id`, or reject if it can't load in time. */
export function loadGis(timeoutMs = LOAD_TIMEOUT_MS): Promise<GisAccountsId> {
  const now = ready();
  if (now) return Promise.resolve(now);
  if (loading) return loading;

  loading = new Promise<GisAccountsId>((resolve, reject) => {
    let script = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`);
    if (!script) {
      script = document.createElement("script");
      script.src = GIS_SRC;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
    const timer = window.setTimeout(() => done(new Error("Google sign-in timed out")), timeoutMs);
    const onLoad = () => done(ready() ? null : new Error("Google sign-in did not initialise"));
    const onError = () => done(new Error("Google sign-in script failed to load"));
    function done(err: Error | null) {
      window.clearTimeout(timer);
      script!.removeEventListener("load", onLoad);
      script!.removeEventListener("error", onError);
      const id = ready();
      if (!err && id) resolve(id);
      else reject(err ?? new Error("Google sign-in unavailable"));
    }
    script.addEventListener("load", onLoad);
    script.addEventListener("error", onError);
  }).catch((err: unknown) => {
    // Let a later mount try again (e.g. a blocker was turned off).
    loading = null;
    throw err;
  });
  return loading;
}
