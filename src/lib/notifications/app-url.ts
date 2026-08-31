// Absolute links for email bodies (deep links, unsubscribe) -- relative URLs
// don't mean anything inside an email client. APP_URL wins when set;
// VERCEL_URL covers preview deploys that never got one; localhost is the dev
// fallback. Server-only (no NEXT_PUBLIC_ prefix) -- only ever called from
// server actions / server-only modules, never from client components.
export function appUrl(path: string): string {
  const base =
    process.env.APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
  return `${base.replace(/\/$/, '')}${path}`;
}
