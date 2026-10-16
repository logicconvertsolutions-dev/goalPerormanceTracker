import { z } from 'zod';
import { DEFAULT_HOURS_PER_WEEK } from './calculate';
import { PROVINCE_NAMES, type ProvinceCode } from './rates-2026';
import { PAY_PERIODS, type TaxInput } from './types';

/*
 * The calculator's inputs live in the URL (filter-state convention) so a
 * scenario survives a reload and can be bookmarked. Nothing is stored
 * server-side. Bad values from a hand-edited URL fall back to defaults
 * rather than erroring.
 */

const PROVINCE_CODES = Object.keys(PROVINCE_NAMES) as [ProvinceCode, ...ProvinceCode[]];

const amount = z.coerce.number().finite().nonnegative().max(100_000_000).catch(0);

const schema = z.object({
  prov: z.enum(PROVINCE_CODES).catch('ON'),
  per: z.enum(PAY_PERIODS).catch('annual'),
  hrs: z.coerce.number().finite().positive().max(168).catch(DEFAULT_HOURS_PER_WEEK),
  emp: amount,
  se: amount,
  oth: amount,
  cg: amount,
  ed: amount,
  nd: amount,
  rrsp: amount,
  paid: amount,
});

const KEYS = {
  province: 'prov',
  payPeriod: 'per',
  hoursPerWeek: 'hrs',
  employmentIncome: 'emp',
  selfEmploymentIncome: 'se',
  otherIncome: 'oth',
  capitalGains: 'cg',
  eligibleDividends: 'ed',
  nonEligibleDividends: 'nd',
  rrspFhsaContributions: 'rrsp',
  incomeTaxesPaid: 'paid',
} as const satisfies Record<keyof TaxInput, keyof z.infer<typeof schema>>;

type RawParams = Record<string, string | string[] | undefined>;

export function parseTaxParams(raw: RawParams): TaxInput {
  const flat = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])
  );
  const p = schema.parse(flat);
  return {
    province: p.prov,
    payPeriod: p.per,
    hoursPerWeek: p.hrs,
    employmentIncome: p.emp,
    selfEmploymentIncome: p.se,
    otherIncome: p.oth,
    capitalGains: p.cg,
    eligibleDividends: p.ed,
    nonEligibleDividends: p.nd,
    rrspFhsaContributions: p.rrsp,
    incomeTaxesPaid: p.paid,
  };
}

/** Only non-default values, so an untouched calculator has a clean URL. */
export function serializeTaxParams(input: TaxInput): URLSearchParams {
  const defaults = parseTaxParams({});
  const out = new URLSearchParams();
  for (const [field, key] of Object.entries(KEYS) as [keyof TaxInput, string][]) {
    if (input[field] !== defaults[field]) out.set(key, String(input[field]));
  }
  return out;
}
