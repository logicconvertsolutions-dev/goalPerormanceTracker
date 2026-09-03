import type { MetadataRoute } from 'next';

// Next's native manifest route — served at /manifest.webmanifest, generated
// at build/request time. Deliberately does not touch public/ (the untracked
// legacy prototype living there is off-limits without asking).

// icon.tsx is served with `Cache-Control: immutable, max-age=31536000`
// (Next's default for file-convention icon routes) -- correct for an asset
// that's expected to never change, but it means any cache (Vercel's edge
// included) that fetched the bare /icon URL before public/kautis-logo.png
// last changed will keep serving those old bytes for up to a year,
// `immutable` meaning it won't even revalidate. Android/desktop PWA installs
// read icons from this manifest, so /icon needs an explicit cache-buster.
// Bump ICON_VERSION whenever the underlying artwork changes; it doesn't need
// to mean anything beyond "different from last time".
//
// iOS "Add to Home Screen" does NOT read icons from this manifest at all --
// it only reads <link rel="apple-touch-icon">, which is set explicitly in
// src/app/layout.tsx pointing at the versioned src/app/apple-touch-icon-v3
// route (bump that folder's version suffix instead of ICON_VERSION below).
const ICON_VERSION = 3;

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
      { src: '/apple-touch-icon-v3', sizes: '180x180', type: 'image/png' },
    ],
  };
}
