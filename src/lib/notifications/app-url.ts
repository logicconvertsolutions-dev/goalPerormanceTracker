// Absolute links for email bodies (deep links, unsubscribe) -- relative URLs
// don't mean anything inside an email client. NEXT_PUBLIC_APP_URL wins when
// set; VERCEL_URL covers preview deploys that never got one; localhost is
// the dev fallback.
export function appUrl(path: string): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
  return `${base.replace(/\/$/, '')}${path}`;
}
