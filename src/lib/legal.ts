// The Terms & Conditions and Privacy Notice version (P33), and who stands
// behind them. Accepted together as one checkbox at signup
// (agents.terms_accepted_at).
//
// Bump LEGAL_VERSION_DATE whenever either page changes materially -- new
// personal information collected, a new use, a new service provider, a
// change to who can see what. Everyone who accepted before that date is sent
// back through /terms/accept once (requireVerifiedAgent), which is how a
// material change gets fresh consent instead of "continuing to use the app
// means you accept".
export const LEGAL_VERSION_DATE = '2026-09-28';

/** What changed in LEGAL_VERSION_DATE, shown to people re-accepting. */
export const LEGAL_CHANGES = [
  'You can now save a phone number on a contact, and call or WhatsApp them from the app.',
  'The privacy notice now lists everything the app stores, who can see it, where it is kept, and how to reach our privacy officer.',
  'The terms now cover calling rules (the National Do Not Call List, CASL) and the contact information you enter about other people.',
] as const;

// Who operates the app and answers privacy requests (PIPEDA Principle 1,
// Accountability). Confirmed by the product owner 2026-09-27.
export const LEGAL_OPERATOR = 'Kautis';
export const PRIVACY_OFFICER_TITLE = 'Privacy Officer';
export const PRIVACY_CONTACT_EMAIL = 'privacy@kautis.ca';

/** True when the agent has not accepted the current version. */
export function needsLegalAcceptance(termsAcceptedAt: string | null | undefined): boolean {
  if (!termsAcceptedAt) return true;
  // Postgres hands back "2026-09-27 21:00:00.1+00" style strings, so compare
  // instants, not text. Midnight UTC starts the version day everywhere.
  return new Date(termsAcceptedAt).getTime() < Date.parse(`${LEGAL_VERSION_DATE}T00:00:00Z`);
}
