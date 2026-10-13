/**
 * The one gate for every `?next=` / post-sign-in destination in the app.
 *
 * react-router's history falls back to `window.location.assign(url)` when
 * `pushState` throws on a cross-origin URL, so an unchecked `next` such as
 * `/\evil.com` or `/%09/evil.com` (browsers strip tabs and treat `\` like `/`)
 * becomes an open redirect. Only a plain same-origin path survives here.
 */

const DEFAULT_BASE = "http://localhost";

/** Backslash, ASCII control chars (< 0x20) and DEL (0x7f). */
function hasForbiddenChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f || c === 0x5c) return true;
  }
  return false;
}

function originBase(): string {
  try {
    if (typeof window !== "undefined" && window.location?.origin) return window.location.origin;
  } catch {
    /* fall through */
  }
  return DEFAULT_BASE;
}

/**
 * Returns `raw` normalised to `pathname + search + hash` when it is a
 * same-origin, single-slash path; otherwise `fallback`. `base` is the origin
 * to resolve against (defaults to the current page; tests pass a fixed one).
 */
export function safeNextPath(raw: string | null | undefined, fallback = "/", base?: string): string {
  if (typeof raw !== "string" || raw === "") return fallback;
  if (hasForbiddenChar(raw)) return fallback;

  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return fallback;
  }
  if (hasForbiddenChar(decoded)) return fallback;

  for (const s of [raw, decoded]) {
    if (!s.startsWith("/") || s.startsWith("//")) return fallback;
  }

  const origin = base ?? originBase();
  let url: URL;
  try {
    url = new URL(raw, origin);
  } catch {
    return fallback;
  }
  if (url.origin !== new URL(origin).origin) return fallback;

  const out = `${url.pathname}${url.search}${url.hash}`;
  // Normalisation must not have produced a protocol-relative path either.
  if (!out.startsWith("/") || out.startsWith("//")) return fallback;
  return out;
}

/** Post-sign-in destination: a safe path that is not /signin itself (else Home). */
export function safeAuthNext(raw: string | null | undefined): string {
  const next = safeNextPath(raw, "/");
  if (next.startsWith("/signin")) return "/";
  return next;
}
