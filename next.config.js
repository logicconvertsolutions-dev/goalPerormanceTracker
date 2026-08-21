// The Supabase URL is a public, build-time-known value (NEXT_PUBLIC_*) --
// safe to bake into the CSP the same way it's baked into the client bundle.
// Falls back to wildcard-subdomain Supabase so a missing env var at build
// time doesn't produce a CSP that silently blocks every API call.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://*.supabase.co';
const supabaseWs = supabaseUrl.replace(/^http/, 'ws');

// 04-security.md: "CSP (no unsafe-eval), HSTS, X-Content-Type-Options:
// nosniff, Referrer-Policy: strict-origin-when-cross-origin,
// X-Frame-Options: DENY". unsafe-inline stays in (Next's hydration script
// tags and Tailwind's inline styles both need it; a nonce-based CSP is a
// bigger change than this phase's scope) -- unsafe-eval is the one this
// phase is explicit about, and it's dropped.
const csp = [
  `default-src 'self'`,
  `script-src 'self' 'unsafe-inline'`,
  `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
  `font-src 'self' https://fonts.gstatic.com`,
  `img-src 'self' data:`,
  `connect-src 'self' ${supabaseUrl} ${supabaseWs}`,
  `frame-ancestors 'none'`,
  `base-uri 'self'`,
  `form-action 'self'`,
].join('; ');

/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    dirs: ['src'],
  },
  typescript: {
    tsconfigPath: './tsconfig.json',
  },
  headers: async () => {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          {
            key: 'Content-Security-Policy',
            value: csp,
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
