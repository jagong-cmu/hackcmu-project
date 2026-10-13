/**
 * Which Google sign-in flow the button uses. Pure, so it is unit-tested.
 *
 * - "gis": Google Identity Services on our own origin (Google's sign-in names
 *   Aria / karaoke-arena.vercel.app), then supabase.auth.signInWithIdToken.
 *   The preferred flow.
 * - "redirect": supabase.auth.signInWithOAuth, a full-page round trip through
 *   <project>.supabase.co/auth/v1/callback (Google names the Supabase domain).
 *   Always works, so it is the fallback whenever GIS can't be used.
 * - "pending": GIS is still loading; show a placeholder rather than a button
 *   that might swap under the user's cursor. Bounded by the load timeout.
 */
export type GisStatus = "loading" | "ready" | "failed";
export type SignInFlow = "gis" | "redirect" | "pending";

/** Google OAuth web client ids look like `123-abc.apps.googleusercontent.com`. */
export function isGoogleClientId(id: string | null | undefined): id is string {
  return (
    typeof id === "string" &&
    /^[0-9]+-[a-z0-9_]+\.apps\.googleusercontent\.com$/i.test(id.trim())
  );
}

export function selectSignInFlow(input: {
  clientId: string | null | undefined;
  status: GisStatus;
  /** The user chose "sign in another way", or GIS failed earlier this page load. */
  forceRedirect?: boolean;
}): SignInFlow {
  if (input.forceRedirect) return "redirect";
  if (!isGoogleClientId(input.clientId)) return "redirect";
  if (input.status === "failed") return "redirect";
  if (input.status === "ready") return "gis";
  return "pending";
}

/** Status to start in: no point loading Google's script without a client id. */
export function initialGisStatus(clientId: string | null | undefined): GisStatus {
  return isGoogleClientId(clientId) ? "loading" : "failed";
}
