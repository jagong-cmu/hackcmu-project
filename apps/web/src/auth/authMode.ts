/**
 * Which account mode the web app runs in. Pure (no `import.meta`) so it can be
 * unit-tested; supabase.ts feeds it the build's env.
 *
 * - "accounts": Supabase is configured. Every match, Training, and the
 *   onboarding checks need a signed-in Google account.
 * - "unconfigured": no Supabase config. Fail closed: play routes show
 *   "Accounts aren't configured" instead of falling back to guest play.
 * - "dev-guest": local `vite dev` only, with VITE_AUTH_REQUIRED=0. The old
 *   guest flow, so one developer can play both seats. `dev` is
 *   `import.meta.env.DEV`, which a production build hard-codes to false, so a
 *   deployed bundle can never reach this mode.
 */
export type ClientAuthMode = "accounts" | "unconfigured" | "dev-guest";

export function resolveClientAuthMode(input: {
  dev: boolean;
  url?: string;
  key?: string;
  optOut?: string;
}): ClientAuthMode {
  if (input.dev && input.optOut?.trim() === "0") return "dev-guest";
  return input.url?.trim() && input.key?.trim() ? "accounts" : "unconfigured";
}
