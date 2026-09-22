/**
 * Where an appointment form returns to after saving (decided 2026-09-22).
 *
 * `/appointments` is not in the navigation, so sending every save there
 * dropped the agent on a page they otherwise never see -- and after
 * opening an appointment from My Day, away from where they were working.
 * The form now goes back to the screen that opened it, carried as a
 * `returnTo` search param, and falls back to Activity Logs' Appointments
 * tab.
 */
export const APPOINTMENTS_FALLBACK = '/logs?type=appointment';

/**
 * Only an in-app path is honoured. `returnTo` arrives in a URL anyone can
 * craft, so anything else -- another origin, a protocol-relative `//host`,
 * a backslash trick -- falls back rather than becoming an open redirect.
 */
export function safeReturnTo(value: string | null | undefined, fallback = APPOINTMENTS_FALLBACK): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback;
  return value;
}

/** `href` with `returnTo` attached, preserving any query `href` already has. */
export function withReturnTo(href: string, returnTo: string): string {
  return `${href}${href.includes('?') ? '&' : '?'}returnTo=${encodeURIComponent(returnTo)}`;
}
