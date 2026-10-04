import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Dark-mode regression guard (P36). A literal colour in a component doesn't
 * follow the theme, so it's the usual way a page ends up with invisible text
 * in one mode. Use a token instead (text-fg, bg-panel, text-on-acc, ...).
 *
 * Allowed: test files, print-only classes (print:text-black), and surfaces
 * that are intentionally fixed in both themes, listed below with the reason.
 */
const SRC = join(__dirname, '..');
const ALLOWED_FILES: Record<string, string> = {
  'app/icon.tsx': 'app icon artwork',
  'app/apple-touch-icon-v3/route.tsx': 'app icon artwork',
  'app/manifest.ts': 'PWA manifest brand colours',
  'app/login/page.tsx': 'brand panel is always navy with white text',
  'app/(app)/today/greeting-hero.tsx': 'navy photo card, white text in both themes',
  'app/(app)/today/quote-card.tsx': 'navy photo card, white text in both themes',
  'components/shell/announcement-banner.tsx': 'navy brand banner, white text in both themes',
  'app/(app)/mfa/setup/mfa-enroll-flow.tsx': 'QR code must stay dark-on-white to scan',
  'components/ui/dialog.tsx': 'black scrim works in both themes',
  'components/shell/contact-call-buttons.tsx': 'white glyph on solid WhatsApp green (hover)',
};

const PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'hex colour', re: /#[0-9a-fA-F]{3,8}\b(?![\w-])/ },
  { name: 'rgb()/rgba() literal', re: /rgba?\(\s*\d/ },
  { name: 'fixed white/black utility', re: /(?<![\w:-])(?:bg|text|border|ring|fill|stroke)-(?:white|black)\b/ },
  { name: 'Tailwind default palette', re: /(?<![\w:-])(?:bg|text|border)-(?:gray|slate|zinc|neutral|stone|red|green|blue|amber|yellow|emerald|rose|orange|sky|indigo)-\d{2,3}\b/ },
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry) ? [full] : [];
  });
}

describe('no hard-coded colours in components', () => {
  const files = [...walk(join(SRC, 'app')), ...walk(join(SRC, 'components'))];

  it('scans a meaningful number of files', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('every colour goes through a theme token', () => {
    const offences: string[] = [];
    for (const file of files) {
      const rel = relative(SRC, file).split('\\').join('/');
      if (ALLOWED_FILES[rel]) continue;
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (/^\s*(\/\/|\*|\{\/\*)/.test(line)) return; // comments
          const stripped = line.replace(/\bprint:[\w-]+(?:\/\d+)?/g, '');
          for (const { name, re } of PATTERNS) {
            if (re.test(stripped)) offences.push(`${rel}:${i + 1} ${name}: ${line.trim().slice(0, 120)}`);
          }
        });
    }
    expect(offences, `Use a theme token instead:\n${offences.join('\n')}`).toEqual([]);
  });

  it('allow-list entries still exist (no stale exemptions)', () => {
    for (const rel of Object.keys(ALLOWED_FILES)) {
      expect(() => statSync(join(SRC, rel)), rel).not.toThrow();
    }
  });
});
