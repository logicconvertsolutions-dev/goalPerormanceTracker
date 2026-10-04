import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

/** A theme colour backed by a `--c-<name>` RGB-channel variable in globals.css. */
const token = (name: string) => `rgb(var(--c-${name}) / <alpha-value>)`;

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
        // Every value is a CSS variable from src/app/globals.css (`:root` for
        // light, `.dark` for dark) wrapped as rgb(var(--x) / <alpha-value>),
        // so the theme switches by re-pointing variables and Tailwind's
        // opacity modifiers (bg-ok/15, border-bad/30, ...) keep working.
        // Never put a literal hex here -- it would not follow the theme.
        //
        // Ground -- page, cards, and the slightly-off surfaces used for row
        // hover and input fields.
        bg: token('bg'),
        'bg-2': token('bg'),
        panel: token('panel'),
        'panel-2': token('panel-2'),
        hover: token('hover'),
        sunken: token('sunken'),
        canvas: token('bg'),
        surface: token('panel'),
        // Text, strongest to most muted. Anything a user reads -- including
        // placeholders and small hints -- uses fg..fg-3 (>=4.5:1). fg-4 is
        // only for icons, decorative glyphs and disabled controls (>=3:1).
        fg: token('fg'),
        'fg-2': token('fg-2'),
        'fg-3': token('fg-3'),
        'fg-4': token('fg-4'),
        // Accent -- primary actions use it, never gold. `on-acc` is the text
        // or icon colour on an acc-filled surface: white on navy in light,
        // navy on light blue in dark. Use it instead of text-white.
        acc: token('acc'),
        'acc-2': token('acc-2'),
        'on-acc': token('on-acc'),
        // Tints of the accent with a fixed, per-theme alpha.
        'acc-dim': 'rgb(var(--c-acc) / var(--acc-dim-alpha))',
        'acc-line': 'rgb(var(--c-acc) / var(--acc-line-alpha))',
        // Brand mark & "filed/complete" status only -- never a general accent.
        gold: token('gold'),
        'gold-dark': token('gold-dark'),
        'gold-light': token('gold-light'),
        // Fixed brand navy: the same in both themes. For brand surfaces that
        // stay navy with white text (greeting hero, quote card, banner).
        navy: 'rgb(11 30 61 / <alpha-value>)',
        'navy-2': 'rgb(18 42 84 / <alpha-value>)',
        // Attainment -- green/amber/red mean target attainment only.
        ok: token('ok'),
        'ok-dim': token('ok-dim'),
        warn: token('warn'),
        'warn-dim': token('warn-dim'),
        bad: token('bad'),
        'bad-dim': token('bad-dim'),
        // Categorical accents for calendar/task kinds and the WhatsApp button.
        'kind-violet': token('violet'),
        'kind-blue': token('blue'),
        'kind-blue-text': token('blue-text'),
        whatsapp: token('whatsapp'),
        'whatsapp-text': token('whatsapp-text'),
      },
      borderColor: {
        line: token('line'),
        // Escalated-emphasis borders: the text colour at low opacity, so they
        // read on both a white and a navy-black ground.
        'line-2': 'rgb(var(--c-fg) / 0.14)',
        'line-3': 'rgb(var(--c-fg) / 0.22)',
      },
      // Bumped up for a softer, more rounded feel across buttons, inputs,
      // menus, and cards — every rounded-sm/DEFAULT/lg usage in the app
      // picks this up automatically (rounded-full elements are unaffected).
      borderRadius: {
        sm: '10px',
        DEFAULT: '14px',
        lg: '20px',
        // Extra step for buttons specifically (see button.tsx) — deliberately
        // not part of the sm/DEFAULT/lg cascade so it doesn't touch cards,
        // inputs, or menus.
        xl: '28px',
      },
      boxShadow: {
        // Values live in globals.css (navy-tinted in light, black in dark).
        // Everyday card/button elevation.
        lift: 'var(--shadow-lift)',
        // Popovers, dropdowns, toasts, the mobile tab bar.
        float: 'var(--shadow-float)',
        // Every Card and card-style surface (KPI tiles, Next Up, tables).
        card: 'var(--shadow-card)',
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
