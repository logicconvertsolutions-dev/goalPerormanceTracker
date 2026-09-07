import 'server-only';

// Mirrors tailwind.config.ts's navy/gold tokens -- the app's actual theme,
// not a placeholder palette. Keep in sync with tailwind.config.ts colors.acc
// / colors.gold if either changes.
export const BRAND = {
  name: 'Kautis',
  navy: '#0B1E3D',
  gold: '#C9A227',
  bg: '#FFFFFF',
  text: '#14213D',
  muted: '#5C6580',
} as const;
