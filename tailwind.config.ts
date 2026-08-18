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
        // Ground
        bg: '#08090A',
        'bg-2': '#0E0F11',
        panel: '#141518',
        'panel-2': '#1A1B1F',
        hover: '#1F2024',
        sunken: '#0B0C0D',
        // Text
        fg: '#EDEEF0',
        'fg-2': '#9CA0A8',
        'fg-3': '#666A73',
        'fg-4': '#4A4D55',
        // Accent
        acc: '#3D9AFF',
        'acc-2': '#7FBBFF',
        'acc-dim': 'rgba(61, 154, 255, 0.13)',
        'acc-line': 'rgba(61, 154, 255, 0.32)',
        // Attainment
        ok: '#3FB950',
        warn: '#D29922',
        bad: '#F85149',
        'warn-dim': 'rgba(210, 153, 34, 0.13)',
        'bad-dim': 'rgba(248, 81, 73, 0.13)',
      },
      borderColor: {
        line: 'rgba(255, 255, 255, 0.065)',
        'line-2': 'rgba(255, 255, 255, 0.11)',
        'line-3': 'rgba(255, 255, 255, 0.18)',
      },
      borderRadius: {
        sm: '6px',
        DEFAULT: '8px',
        lg: '12px',
      },
      boxShadow: {
        lift: 'inset 0 1px 0 rgba(255, 255, 255, 0.04)',
      },
      fontFamily: {
        ui: [
          'Inter',
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
