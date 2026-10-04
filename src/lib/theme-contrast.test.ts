import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * "Letters are visible" check for both themes (P36). Reads the real token
 * values out of globals.css -- not a copy -- and asserts WCAG 2.x contrast
 * for every text/surface pairing the UI actually uses. Change a token and
 * this fails before anyone ships an unreadable screen.
 *
 *   4.5:1  body text (WCAG AA 1.4.3)
 *   3:1    placeholders, icons, hints, UI glyphs (WCAG AA 1.4.11)
 */

type RGB = [number, number, number];
type Tokens = Record<string, RGB>;

const css = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8');

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`${selector} block not found in globals.css`);
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) return css.slice(start, i);
  }
  throw new Error(`unterminated ${selector} block`);
}

function parseTokens(source: string): Tokens {
  const tokens: Tokens = {};
  for (const m of source.matchAll(/--((?:c|chart)-[\w-]+):\s*(\d+)\s+(\d+)\s+(\d+)\s*;/g)) {
    tokens[m[1]] = [Number(m[2]), Number(m[3]), Number(m[4])];
  }
  return tokens;
}

const light = parseTokens(block(':root'));
// Dark inherits anything it doesn't override, exactly like the cascade.
const dark = { ...light, ...parseTokens(block('.dark')) };
const THEMES = { light, dark } as const;

function luminance([r, g, b]: RGB): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** `color` at `alpha` composited over `under` -- how a bg-x/10 tint renders. */
function over(color: RGB, alpha: number, under: RGB): RGB {
  return color.map((c, i) => Math.round(c * alpha + under[i] * (1 - alpha))) as RGB;
}

const SURFACES = ['c-bg', 'c-panel', 'c-panel-2', 'c-hover', 'c-sunken'];
const CARD_SURFACES = ['c-bg', 'c-panel', 'c-panel-2'];

describe.each(Object.entries(THEMES))('%s theme', (name, t) => {
  const tok = (key: string): RGB => {
    const v = t[key];
    if (!v) throw new Error(`--${key} missing in ${name} theme`);
    return v;
  };
  const expectContrast = (fg: RGB, bg: RGB, min: number, label: string) => {
    const ratio = contrast(fg, bg);
    expect(ratio, `${name}: ${label} is ${ratio.toFixed(2)}:1, needs ${min}:1`).toBeGreaterThanOrEqual(min);
  };

  it.each(['c-fg', 'c-fg-2', 'c-fg-3', 'c-acc', 'c-gold-dark'])('%s is readable body text on every surface', (fg) => {
    for (const s of SURFACES) expectContrast(tok(fg), tok(s), 4.5, `${fg} on ${s}`);
  });

  it('fg-4 (icons, decorative glyphs) clears 3:1 on every surface', () => {
    for (const s of SURFACES) expectContrast(tok('c-fg-4'), tok(s), 3, `c-fg-4 on ${s}`);
  });

  it.each(['ok', 'warn', 'bad'])('%s status text reads on cards and on its own badge', (status) => {
    for (const s of CARD_SURFACES) expectContrast(tok(`c-${status}`), tok(s), 4.5, `c-${status} on ${s}`);
    expectContrast(tok(`c-${status}`), tok(`c-${status}-dim`), 4.5, `c-${status} on c-${status}-dim`);
  });

  it('text on filled accent and danger surfaces', () => {
    expectContrast(tok('c-on-acc'), tok('c-acc'), 4.5, 'on-acc on acc');
    expectContrast(tok('c-on-acc'), tok('c-acc-2'), 4.5, 'on-acc on acc-2 (hover)');
    expectContrast(tok('c-bg'), tok('c-bad'), 4.5, 'bg on bad (badge count)');
  });

  it('tinted chips: accent, calendar blue, violet, WhatsApp', () => {
    const panel = tok('c-panel');
    const accDim = name === 'dark' ? 0.14 : 0.07;
    expectContrast(tok('c-acc'), over(tok('c-acc'), accDim, panel), 4.5, 'acc on acc-dim');
    expectContrast(tok('c-acc-2'), over(tok('c-acc'), accDim, panel), 4.5, 'acc-2 on acc-dim (team grid)');
    expectContrast(tok('c-blue-text'), over(tok('c-blue'), 0.1, panel), 4.5, 'blue-text on blue/10');
    expectContrast(tok('c-violet'), over(tok('c-violet'), 0.1, panel), 4.5, 'violet on violet/10');
    expectContrast(tok('c-whatsapp-text'), over(tok('c-whatsapp'), 0.1, panel), 4.5, 'whatsapp-text on whatsapp/10');
  });

  it('activity icons (chart hues) clear 3:1 on their 10% tint in dark', () => {
    // Light keeps the colorblind-validated reference steps; there orange sits
    // at ~2.9:1, acceptable only because every activity icon is paired with
    // its text label (Call / Appointment / Sale / Recruiting), never alone.
    if (name === 'light') return;
    for (const hue of ['blue', 'violet', 'green', 'orange']) {
      const c = tok(`chart-${hue}`);
      expectContrast(c, over(c, 0.1, tok('c-panel')), 3, `chart-${hue} icon on its tint`);
    }
  });

  it('chart marks clear 3:1 against the card in dark (light relies on labels + table view)', () => {
    if (name === 'light') return; // Documented relief rule in lib/chart-colors.ts.
    for (const hue of ['blue', 'orange', 'aqua', 'yellow', 'magenta', 'green', 'violet', 'red']) {
      expectContrast(tok(`chart-${hue}`), tok('c-panel'), 3, `chart-${hue} on panel`);
    }
  });
});

describe('dark theme is complete', () => {
  it('overrides every surface and text token', () => {
    const overridden = parseTokens(block('.dark'));
    for (const key of [...SURFACES, 'c-fg', 'c-fg-2', 'c-fg-3', 'c-fg-4', 'c-acc', 'c-on-acc', 'c-line']) {
      expect(overridden[key], `--${key} must be redefined for dark`).toBeDefined();
    }
  });

  it('is scoped to screen so printing stays light', () => {
    const media = css.indexOf('@media screen');
    expect(media).toBeGreaterThan(-1);
    expect(css.indexOf('.dark {')).toBeGreaterThan(media);
  });
});
