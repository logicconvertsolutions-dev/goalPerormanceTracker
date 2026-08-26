import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

const config = {
  darkMode: ['class'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Values are kept as literal hex (not var(--x)) so Tailwind's built-in opacity
        // modifiers (bg-ok/15, bg-bad/20, ...) keep working — Tailwind can only derive
        // an alpha-channel variant from a color it can parse itself, not from an opaque
        // var() reference. The same values are declared as CSS custom properties in
        // globals.css :root as the source of truth / for use outside Tailwind classes.
        //
        // Ground — page background & chrome now match the white surface tone.
        // hover/sunken stay a hair off pure white so row-hover feedback and
        // input fields remain visible against a white page.
        bg: '#FFFFFF',
        'bg-2': '#FFFFFF',
        panel: '#FFFFFF',
        'panel-2': '#FFFFFF',
        hover: '#F4F4F5',
        sunken: '#F4F4F5',
        // Text
        fg: '#14213D',
        'fg-2': '#5C6580',
        'fg-3': '#94A0B8',
        // fg-4: no --text-4 token in the spec; derived as a washed-out --text-3 for the
        // most muted/disabled labels (e.g. strikethrough list items).
        'fg-4': 'rgba(148, 160, 184, 0.7)',
        // Accent — primary actions use navy, never gold (see brand-mark exception below)
        acc: '#0B1E3D',
        'acc-2': '#122A54',
        // acc-dim/acc-line: no dedicated tokens given; derived from --navy at low opacity,
        // same pattern the spec already uses for warn-dim/bad-dim.
        'acc-dim': 'rgba(11, 30, 61, 0.07)',
        'acc-line': 'rgba(11, 30, 61, 0.28)',
        // Brand mark & "filed/complete" status only — never a general accent/button color
        gold: '#C9A227',
        'gold-dark': '#9C7C1A',
        'gold-light': '#FBF3D9',
        navy: '#0B1E3D',
        'navy-2': '#122A54',
        canvas: '#FFFFFF',
        surface: '#FFFFFF',
        // Attainment
        ok: '#1B7A43',
        'ok-dim': '#E4F5EA',
        warn: '#9C6A0A',
        'warn-dim': '#FBF0DA',
        bad: '#B0392A',
        'bad-dim': '#FBE6E2',
      },
      borderColor: {
        line: '#E7E2D3',
        // line-2/line-3: no escalated-emphasis border tokens given; derived from --text-1
        // (navy-ish) at increasing opacity, mirroring the acc-dim/acc-line derivation above.
        'line-2': 'rgba(20, 33, 61, 0.14)',
        'line-3': 'rgba(20, 33, 61, 0.22)',
      },
      // Bumped up for a softer, more rounded feel across buttons, inputs,
      // menus, and cards — every rounded-sm/DEFAULT/lg usage in the app
      // picks this up automatically (rounded-full elements are unaffected).
      borderRadius: {
        sm: '10px',
        DEFAULT: '14px',
        lg: '20px',
      },
      boxShadow: {
        // Everyday card/button elevation — a touch stronger than a hairline so
        // surfaces read as raised off the canvas instead of flat cutouts.
        lift: '0 1px 3px 0 rgba(11, 30, 61, 0.10), 0 1px 2px -1px rgba(11, 30, 61, 0.08)',
        // Heavier elevation for things that should visually float above the
        // page — popovers, dropdowns, toasts, the mobile tab bar.
        float: '0 8px 24px -4px rgba(11, 30, 61, 0.16), 0 2px 8px -2px rgba(11, 30, 61, 0.10)',
        // Pronounced "floating card" elevation — every Card and card-style
        // surface (KPI tiles, the Next Up card, list/table containers).
        // Deliberately heavier than `float` per an explicit request for more
        // shadow on cards specifically, without changing buttons, menus, or
        // toasts, which stay on `lift`/`float`.
        card: '0 14px 32px -8px rgba(11, 30, 61, 0.20), 0 4px 12px -2px rgba(11, 30, 61, 0.12)',
      },
      fontFamily: {
        ui: [
          'Plus Jakarta Sans',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'sans-serif',
        ],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        xs: ['12px', { lineHeight: '1.5' }],
        sm: ['13px', { lineHeight: '1.5' }],
        base: ['14px', { lineHeight: '1.6' }],
        lg: ['16px', { lineHeight: '1.6' }],
        xl: ['18px', { lineHeight: '1.7' }],
        '2xl': ['20px', { lineHeight: '1.7' }],
        '3xl': ['24px', { lineHeight: '1.8' }],
      },
      letterSpacing: {
        tight: '-0.006em',
        'heading-tight': '-0.025em',
        mono: '-0.045em',
      },
    },
  },
  plugins: [animate],
} satisfies Config;

export default config;
