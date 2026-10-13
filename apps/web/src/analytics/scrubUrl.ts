/**
 * Strip auth secrets out of URLs before PostHog sees them. The OAuth return
 * lands on `/signin?code=…` (PKCE) or `/signin#access_token=…` (implicit), and
 * failures carry `error_description`; pageview/autocapture events would
 * otherwise ship those in `$current_url`, `$referrer`, `$initial_*`, etc.
 */

/** Query params removed from every URL-ish property (matched case-insensitively). */
export const SensitiveParams = [
  "code",
  "state",
  "error",
  "error_code",
  "error_description",
  "access_token",
  "refresh_token",
  "id_token",
  "provider_token",
  "provider_refresh_token",
  "token",
  "token_hash",
  "nonce",
] as const;

const SENSITIVE = new Set<string>(SensitiveParams);
const RELATIVE_BASE = "http://relative.invalid";

/** Remove sensitive query params and the whole fragment from one URL or path. */
export function scrubUrl(raw: string): string {
  if (!raw.includes("?") && !raw.includes("#")) return raw;
  let url: URL;
  let relative = false;
  try {
    url = new URL(raw);
  } catch {
    try {
      url = new URL(raw, RELATIVE_BASE);
      relative = true;
    } catch {
      return raw.split(/[?#]/)[0] ?? "";
    }
  }
  for (const key of [...url.searchParams.keys()]) {
    if (SENSITIVE.has(key.toLowerCase())) url.searchParams.delete(key);
  }
  url.hash = "";
  if (relative) return `${url.pathname}${url.search}`;
  return url.href;
}

/** Property names that carry a URL (`$current_url`, `$referrer`, `$initial_current_url`, `$session_entry_url`, …). */
function isUrlKey(key: string): boolean {
  return /(url|referrer|href|pathname)$/i.test(key);
}

/** Returns a copy of `props` with every URL-ish string property scrubbed. */
export function scrubProperties<T extends Record<string, unknown> | undefined>(props: T): T {
  if (!props) return props;
  const out: Record<string, unknown> = { ...props };
  for (const [key, value] of Object.entries(out)) {
    if (typeof value === "string" && isUrlKey(key)) out[key] = scrubUrl(value);
  }
  return out as T;
}
