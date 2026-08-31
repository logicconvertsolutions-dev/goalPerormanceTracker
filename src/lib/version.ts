// Baked in at build time by next.config.js (package.json version + the
// deployed Vercel commit SHA, when building on Vercel). Safe to import from
// both server and client code.
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || '0.0.0';
export const BUILD_SHA = process.env.NEXT_PUBLIC_BUILD_SHA || null;

/** e.g. "v0.0.1" or "v0.0.1 · a1b2c3d" when a build SHA is available. */
export function formatVersion(): string {
  return BUILD_SHA ? `v${APP_VERSION} · ${BUILD_SHA}` : `v${APP_VERSION}`;
}
