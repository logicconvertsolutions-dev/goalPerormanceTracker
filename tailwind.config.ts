import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

/** A theme-aware colour: an RGB triplet in a CSS variable, alpha left to Tailwind. */
const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

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
        // Every theme-dependent colour is an RGB triplet held in a CSS custom
        // property (globals.css: `:root` = light, `.dark` = dark) and wrapped
        // here as `rgb(var(--x) / <alpha-value>)`. Tailwind substitutes the
        // alpha itself, so opacity modifiers (bg-ok/15, bg-acc/10, ...) keep
        // working — the reason these used to be literal hex — while the value
        // now follows the Auto / Light / Dark setting (03-ui.md "Theme rule").
        // globals.css is the single source of truth for the values.
        //
        // Ground
        bg: v('c-bg'),
        'bg-2': v('c-bg'),
        panel: v('c-panel'),
        'panel-2': v('c-panel'),
        hover: v('c-hover'),
        sunken: v('c-hover'),
        // Text
        fg: v('c-fg'),
        'fg-2': v('c-fg-2'),
        'fg-3': v('c-fg-3'),
        // fg-4: a washed-out fg-3 for the most muted/disabled labels. Carries
        // its own alpha, so it takes no opacity modifier.
        'fg-4': 'var(--c-fg-4)',
        // Accent — navy ink and quiet fills (active chips, avatar, the matrix).
        // As a *text* colour it resolves to --c-acc-text instead (textColor
        // below): navy in light, a lighter blue in dark where navy ink would
        // vanish into the ground.
        acc: v('c-acc'),
        'acc-2': v('c-acc-2'),
        'acc-dim': 'var(--c-acc-dim)',
        'acc-line': 'var(--c-acc-line)',
        // Brand mark & "filed/complete" status. The primary button uses `pop` below.
        gold: v('c-gold'),
        'gold-dark': v('c-gold-dark'),
        'gold-light': v('c-gold-light'),
        // Brand constants: the same navy in both themes (header bar, rail).
        // The pop: primary button only (Button variant="primary"). See 03-ui.md.
        pop: v('c-pop'),
        'pop-2': v('c-pop-2'),
        'pop-ink': v('c-pop-ink'),
        'pop-edge': v('c-pop-edge'),
        navy: '#0B1E3D',
        'navy-2': '#122A54',
        canvas: v('c-bg'),
        surface: v('c-panel'),
        // Attainment
        ok: v('c-ok'),
        'ok-dim': v('c-ok-dim'),
        warn: v('c-warn'),
        'warn-dim': v('c-warn-dim'),
        bad: v('c-bad'),
        'bad-dim': v('c-bad-dim'),
      },
      textColor: {
        // See `acc` above.
        acc: v('c-acc-text'),
        // `text-bg` is only ever the label on an accent fill (primary button,
        // avatar, active filter chip): white in both themes, not the page ground.
        bg: v('c-on-acc'),
      },
      borderColor: {
        line: v('c-line'),
        // line-2/line-3: escalating emphasis, each with its own alpha.
        'line-2': 'var(--c-line-2)',
        'line-3': 'var(--c-line-3)',
      },
      // Bumped up for a softer, more rounded feel across buttons, inputs,
      // menus, and cards — every rounded-sm/DEFAULT/lg usage in the app
      // picks this up automatically (rounded-full elements are unaffected).
      borderRadius: {
        // One scale (03-ui.md "Crisp pass"): 8 inputs and small controls,
        // 12 buttons and tiles, 16 cards. Pills (rounded-full) are for chips
        // and navigation only. Do not add arbitrary rounded-[Npx] values.
        sm: '8px',
        DEFAULT: '12px',
        lg: '16px',
        xl: '16px',
      },
      boxShadow: {
        // Everyday card/button elevation — a touch stronger than a hairline so
        // surfaces read as raised off the canvas instead of flat cutouts.
        lift: 'var(--shadow-lift)',
        // Heavier elevation for things that should visually float above the
        // page — popovers, dropdowns, toasts, the mobile tab bar.
        float: 'var(--shadow-float)',
        // Pronounced "floating card" elevation — every Card and card-style
        // surface (KPI tiles, the Next Up card, list/table containers).
        // Deliberately heavier than `float` per an explicit request for more
        // shadow on cards specifically, without changing buttons, menus, or
        // toasts, which stay on `lift`/`float`.
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
