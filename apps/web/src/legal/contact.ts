/**
 * The few facts the Privacy Policy and Terms need that only the operator can
 * supply. Change them here; /privacy, /terms and the static HTML copies built
 * into dist/ all read from this file.
 */

/** Where privacy questions, deletion requests and reports go. Publicly shown. */
export const LEGAL_CONTACT_EMAIL = "jagong@andrew.cmu.edu";

/** Who runs the service, as it should appear in the documents. */
export const LEGAL_OPERATOR = "the Aria team";

/** Governing law / venue for the Terms, e.g. "the State of Pennsylvania, USA". */
export const LEGAL_GOVERNING_LAW = "the Commonwealth of Pennsylvania, USA";

/** Shown as "Last updated" on both documents (ISO date). */
export const LEGAL_LAST_UPDATED = "2026-10-13";

/** Canonical site origin, used in the static copies' <link rel="canonical">. */
export const LEGAL_SITE_ORIGIN = "https://karaoke-arena.vercel.app";
