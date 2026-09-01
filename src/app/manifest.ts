import type { MetadataRoute } from 'next';

// Next's native manifest route — served at /manifest.webmanifest, generated
// at build/request time. Deliberately does not touch public/ (the untracked
// legacy prototype living there is off-limits without asking).

// icon.tsx/apple-icon.tsx are served with `Cache-Control: immutable,
// max-age=31536000` (Next's default for file-convention icon routes) --
// correct for an asset that's expected to never change, but it means any
// cache (Vercel's edge included) that fetched the bare /icon or /apple-icon
// URL before public/kautis-logo.png last changed will keep serving those
// old bytes for up to a year, `immutable` meaning it won't even revalidate.
// "Add to Home Screen" reads its icon from here, not from the auto-hashed
// <link rel="icon"> Next puts in <head> (that one busts its own cache via a
// content-hash query string) -- so this is the one place that needs an
// explicit cache-buster. Bump ICON_VERSION whenever the underlying artwork
// changes; it doesn't need to mean anything beyond "different from last time".
const ICON_VERSION = 2;

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Kautis',
    short_name: 'Kautis',
    description: 'From action to achievement — callback queue and activity tracker for WFG teams.',
    start_url: '/today',
    display: 'standalone',
    background_color: '#F7F5EF',
    theme_color: '#0B1E3D',
    icons: [
      { src: `/icon?v=${ICON_VERSION}`, sizes: '512x512', type: 'image/png' },
      { src: `/apple-icon?v=${ICON_VERSION}`, sizes: '180x180', type: 'image/png' },
    ],
  };
}
