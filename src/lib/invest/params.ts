import { z } from 'zod';
import { MAX_YEARS, MIN_YEARS, RATE_SLOTS, type InvestInput } from './types';

/*
 * Investment Calculator inputs in the URL (and, through it, the tab's
 * session draft — lib/tools/session-draft.ts). Percentages are written as
 * people type them ("6" = 6%) and stored as fractions. Bad values from a
 * hand-edited URL fall back to defaults rather than erroring.
 */

export const DEFAULT_RATES = [0.04, 0.06, 0.08, 0.1];
export const DEFAULT_YEARS = 25;
export const DEFAULT_INFLATION = 0.02;
const MAX_RATE_PCT = 30;

const amount = z.coerce.number().finite().nonnegative().max(1_000_000_000).catch(0);
const pct = (fallback: number, max: number) =>
  z.coerce.number().finite().min(0).max(max).catch(fallback);

const schema = z.object({
  ls: amount,
  mo: amount,
  yrs: z.coerce.number().int().min(MIN_YEARS).max(MAX_YEARS).catch(DEFAULT_YEARS),
  r1: pct(DEFAULT_RATES[0] * 100, MAX_RATE_PCT),
  r2: pct(DEFAULT_RATES[1] * 100, MAX_RATE_PCT),
  r3: pct(DEFAULT_RATES[2] * 100, MAX_RATE_PCT),
  r4: pct(DEFAULT_RATES[3] * 100, MAX_RATE_PCT),
  on: z.string().regex(/^[01]{4}$/).catch('1111'),
  inc: pct(0, 50),
  tim: z.enum(['start', 'end']).catch('end'),
  inf: pct(DEFAULT_INFLATION * 100, 20),
  real: z.enum(['0', '1']).catch('0'),
  goal: amount,
});

type RawParams = Record<string, string | string[] | undefined>;

/** Percent number -> fraction without float noise (6.1 -> 0.061, not 0.06099999). */
function toFraction(pctValue: number): number {
  return Math.round(pctValue * 1e6) / 1e8;
}

function toPct(fraction: number): string {
  return String(Math.round(fraction * 1e8) / 1e6);
}

export function parseInvestParams(raw: RawParams): InvestInput {
  const flat = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])
  );
  const p = schema.parse(flat);
  const pcts = [p.r1, p.r2, p.r3, p.r4];
  return {
    lumpSum: p.ls,
    monthly: p.mo,
    years: p.yrs,
    rates: pcts.map((r, i) => ({ rate: toFraction(r), on: p.on[i] === '1' })),
    contributionIncrease: toFraction(p.inc),
    timing: p.tim,
    inflation: toFraction(p.inf),
    showReal: p.real === '1',
    goal: p.goal,
  };
}

/** Only non-default values, so an untouched calculator has a clean URL. */
export function serializeInvestParams(input: InvestInput): URLSearchParams {
  const d = parseInvestParams({});
  const out = new URLSearchParams();
  const set = (key: string, value: string, fallback: string) => {
    if (value !== fallback) out.set(key, value);
  };
  set('ls', String(input.lumpSum), String(d.lumpSum));
  set('mo', String(input.monthly), String(d.monthly));
  set('yrs', String(input.years), String(d.years));
  for (let i = 0; i < RATE_SLOTS; i++) {
    set(`r${i + 1}`, toPct(input.rates[i].rate), toPct(d.rates[i].rate));
  }
  set('on', input.rates.map((r) => (r.on ? '1' : '0')).join(''), '1111');
  set('inc', toPct(input.contributionIncrease), toPct(d.contributionIncrease));
  set('tim', input.timing, d.timing);
  set('inf', toPct(input.inflation), toPct(d.inflation));
  set('real', input.showReal ? '1' : '0', '0');
  set('goal', String(input.goal), String(d.goal));
  return out;
}
