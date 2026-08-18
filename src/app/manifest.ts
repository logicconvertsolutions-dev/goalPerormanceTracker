import type { MetadataRoute } from 'next';

// Next's native manifest route — served at /manifest.webmanifest, generated
// at build/request time. Deliberately does not touch public/ (the untracked
// legacy prototype living there is off-limits without asking).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Performance Tracker',
    short_name: 'Tracker',
    description: 'Callback queue and activity tracker for WFG teams.',
    start_url: '/today',
    display: 'standalone',
    background_color: '#08090A',
    theme_color: '#08090A',
    icons: [
      { src: '/icon', sizes: '512x512', type: 'image/png' },
      { src: '/apple-icon', sizes: '180x180', type: 'image/png' },
    ],
  };
}
