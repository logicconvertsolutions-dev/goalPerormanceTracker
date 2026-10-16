/**
 * 2026 Canadian income tax and payroll parameters for the Tax Calculator
 * (/tools/tax-calculator). Annual (T1 return) values — NOT the prorated
 * July-December payroll values T4127-JUL prints for BC, NL and PE.
 *
 * UPDATE EVERY JANUARY: add a rates-<year>.ts beside this one rather than
 * editing these numbers in place, and re-run calculate.test.ts — its golden
 * cases come from the published 2026 tables listed below and will (rightly)
 * fail against a new year's rates until they are refreshed too.
 *
 * Sources (checked 2026-10-16):
 * - CRA, "Canadian income tax rates for individuals - current and previous
 *   years" (2026 federal + provincial/territorial brackets).
 * - CRA T4127 Payroll Deductions Formulas, 122nd ed. (Jan 1 2026) and 123rd
 *   ed. (Jul 1 2026): Tables 8.1-8.8 — personal amounts, Ontario surtax /
 *   health premium / tax reduction, CPP/QPP, EI, QPIP.
 * - BC Budget 2026: lowest rate 5.06% -> 5.60% for the 2026 year (the 6.14%
 *   in T4127-JUL is the half-year proration), BC tax reduction $690.
 * - NL: annual basic amount $13,094 (T4127-JUL's $15,000 is the proration).
 * - PE: new 20% bracket over $200,000 for 2026 (T4127-JUL's 21% is the
 *   proration).
 * - Revenu Quebec / Raymond Chabot Grant Thornton "Individual taxation -
 *   Quebec - 2026" (Apr 30 2026): Quebec brackets, basic amount, deduction
 *   for workers, dividend tax credits, combined top marginal rates.
 * - Quebec.ca: QPIP 2026 self-employed rate 0.764%.
 * - TaxTips.ca dividend tax credit tables (2026 provincial DTC rates;
 *   cross-checked against RCGT's combined top dividend rates).
 */

export const TAX_YEAR = 2026;

export type ProvinceCode =
  | 'AB'
  | 'BC'
  | 'MB'
  | 'NB'
  | 'NL'
  | 'NS'
  | 'NT'
  | 'NU'
  | 'ON'
  | 'PE'
  | 'QC'
  | 'SK'
  | 'YT';

/** A bracket starts at `from` (exclusive) and runs to the next bracket's `from`. */
export interface Bracket {
  from: number;
  rate: number;
}

/** A personal amount that phases down linearly between two net-income points. */
export interface PersonalAmount {
  amount: number;
  phaseOut?: { from: number; to: number; min: number };
}

export const FEDERAL = {
  brackets: [
    { from: 0, rate: 0.14 },
    { from: 58_523, rate: 0.205 },
    { from: 117_045, rate: 0.26 },
    { from: 181_440, rate: 0.29 },
    { from: 258_482, rate: 0.33 },
  ] as Bracket[],
  /** Non-refundable credits are taken at the lowest rate. */
  creditRate: 0.14,
  basicPersonalAmount: {
    amount: 16_452,
    phaseOut: { from: 181_440, to: 258_482, min: 14_829 },
  } as PersonalAmount,
  canadaEmploymentAmount: 1_501,
  eligibleDividendCredit: 0.150198,
  nonEligibleDividendCredit: 0.090301,
  /** Federal tax reduction for Quebec residents. */
  quebecAbatement: 0.165,
} as const;

export const DIVIDEND_GROSS_UP = { eligible: 1.38, nonEligible: 1.15 } as const;
export const CAPITAL_GAINS_INCLUSION = 0.5;

export interface PensionPlanRates {
  ympe: number;
  yampe: number;
  basicExemption: number;
  /** Base portion: credit, not deduction. */
  baseRate: number;
  /** First additional ("enhanced") portion: deductible. */
  firstAdditionalRate: number;
  /** Second additional (CPP2/QPP2) on earnings between YMPE and YAMPE: deductible. */
  secondAdditionalRate: number;
}

export const CPP: PensionPlanRates = {
  ympe: 74_600,
  yampe: 85_000,
  basicExemption: 3_500,
  baseRate: 0.0495,
  firstAdditionalRate: 0.01,
  secondAdditionalRate: 0.04,
};

export const QPP: PensionPlanRates = {
  ...CPP,
  baseRate: 0.053,
};

export const EI = {
  maxInsurableEarnings: 68_900,
  rate: 0.0163,
  quebecRate: 0.013,
  employerMultiplier: 1.4,
} as const;

export const QPIP = {
  maxInsurableEarnings: 103_000,
  employeeRate: 0.0043,
  employerRate: 0.00602,
  selfEmployedRate: 0.00764,
} as const;

export interface ProvinceRates {
  name: string;
  brackets: Bracket[];
  /** 'federal' = mirrors the federal amount and phase-out (Yukon). */
  basicPersonalAmount: PersonalAmount | 'federal';
  /** Lowest bracket rate — what non-refundable credits are worth. */
  creditRate: number;
  eligibleDividendCredit: number;
  nonEligibleDividendCredit: number;
  /** Yukon is the only province/territory with its own Canada employment amount. */
  canadaEmploymentAmount?: number;
}

export const PROVINCES: Record<Exclude<ProvinceCode, 'QC'>, ProvinceRates> = {
  AB: {
    name: 'Alberta',
    brackets: [
      { from: 0, rate: 0.08 },
      { from: 61_200, rate: 0.1 },
      { from: 154_259, rate: 0.12 },
      { from: 185_111, rate: 0.13 },
      { from: 246_813, rate: 0.14 },
      { from: 370_220, rate: 0.15 },
    ],
    basicPersonalAmount: { amount: 22_769 },
    creditRate: 0.08,
    eligibleDividendCredit: 0.0812,
    nonEligibleDividendCredit: 0.0218,
  },
  BC: {
    name: 'British Columbia',
    brackets: [
      { from: 0, rate: 0.056 },
      { from: 50_363, rate: 0.077 },
      { from: 100_728, rate: 0.105 },
      { from: 115_648, rate: 0.1229 },
      { from: 140_430, rate: 0.147 },
      { from: 190_405, rate: 0.168 },
      { from: 265_545, rate: 0.205 },
    ],
    basicPersonalAmount: { amount: 13_216 },
    creditRate: 0.056,
    eligibleDividendCredit: 0.12,
    nonEligibleDividendCredit: 0.0196,
  },
  MB: {
    name: 'Manitoba',
    // Brackets and basic amount frozen at 2024 levels (Manitoba Budget 2025).
    brackets: [
      { from: 0, rate: 0.108 },
      { from: 47_000, rate: 0.1275 },
      { from: 100_000, rate: 0.174 },
    ],
    basicPersonalAmount: { amount: 15_780, phaseOut: { from: 200_000, to: 400_000, min: 0 } },
    creditRate: 0.108,
    eligibleDividendCredit: 0.08,
    nonEligibleDividendCredit: 0.007835,
  },
  NB: {
    name: 'New Brunswick',
    brackets: [
      { from: 0, rate: 0.094 },
      { from: 52_333, rate: 0.14 },
      { from: 104_666, rate: 0.16 },
      { from: 193_861, rate: 0.195 },
    ],
    basicPersonalAmount: { amount: 13_664 },
    creditRate: 0.094,
    eligibleDividendCredit: 0.14,
    nonEligibleDividendCredit: 0.0275,
  },
  NL: {
    name: 'Newfoundland and Labrador',
    brackets: [
      { from: 0, rate: 0.087 },
      { from: 44_678, rate: 0.145 },
      { from: 89_354, rate: 0.158 },
      { from: 159_528, rate: 0.178 },
      { from: 223_340, rate: 0.198 },
      { from: 285_319, rate: 0.208 },
      { from: 570_638, rate: 0.213 },
      { from: 1_141_275, rate: 0.218 },
    ],
    basicPersonalAmount: { amount: 13_094 },
    creditRate: 0.087,
    eligibleDividendCredit: 0.063,
    nonEligibleDividendCredit: 0.032,
  },
  NS: {
    name: 'Nova Scotia',
    brackets: [
      { from: 0, rate: 0.0879 },
      { from: 30_995, rate: 0.1495 },
      { from: 61_991, rate: 0.1667 },
      { from: 97_417, rate: 0.175 },
      { from: 157_124, rate: 0.21 },
    ],
    basicPersonalAmount: { amount: 11_932 },
    creditRate: 0.0879,
    eligibleDividendCredit: 0.0885,
    nonEligibleDividendCredit: 0.015,
  },
  NT: {
    name: 'Northwest Territories',
    brackets: [
      { from: 0, rate: 0.059 },
      { from: 53_003, rate: 0.086 },
      { from: 106_009, rate: 0.122 },
      { from: 172_346, rate: 0.1405 },
    ],
    basicPersonalAmount: { amount: 18_198 },
    creditRate: 0.059,
    eligibleDividendCredit: 0.115,
    nonEligibleDividendCredit: 0.06,
  },
  NU: {
    name: 'Nunavut',
    brackets: [
      { from: 0, rate: 0.04 },
      { from: 55_801, rate: 0.07 },
      { from: 111_602, rate: 0.09 },
      { from: 181_439, rate: 0.115 },
    ],
    basicPersonalAmount: { amount: 19_659 },
    creditRate: 0.04,
    eligibleDividendCredit: 0.0551,
    nonEligibleDividendCredit: 0.0261,
  },
  ON: {
    name: 'Ontario',
    brackets: [
      { from: 0, rate: 0.0505 },
      { from: 53_891, rate: 0.0915 },
      { from: 107_785, rate: 0.1116 },
      { from: 150_000, rate: 0.1216 },
      { from: 220_000, rate: 0.1316 },
    ],
    basicPersonalAmount: { amount: 12_989 },
    creditRate: 0.0505,
    eligibleDividendCredit: 0.1,
    nonEligibleDividendCredit: 0.029863,
  },
  PE: {
    name: 'Prince Edward Island',
    brackets: [
      { from: 0, rate: 0.095 },
      { from: 33_928, rate: 0.1347 },
      { from: 65_820, rate: 0.166 },
      { from: 106_890, rate: 0.1762 },
      { from: 142_520, rate: 0.19 },
      { from: 200_000, rate: 0.2 },
    ],
    basicPersonalAmount: { amount: 15_000 },
    creditRate: 0.095,
    eligibleDividendCredit: 0.105,
    nonEligibleDividendCredit: 0.013,
  },
  SK: {
    name: 'Saskatchewan',
    brackets: [
      { from: 0, rate: 0.105 },
      { from: 54_532, rate: 0.125 },
      { from: 155_805, rate: 0.145 },
    ],
    basicPersonalAmount: { amount: 20_381 },
    creditRate: 0.105,
    eligibleDividendCredit: 0.11,
    nonEligibleDividendCredit: 0.02519,
  },
  YT: {
    name: 'Yukon',
    brackets: [
      { from: 0, rate: 0.064 },
      { from: 58_523, rate: 0.09 },
      { from: 117_045, rate: 0.109 },
      { from: 181_440, rate: 0.128 },
      { from: 500_000, rate: 0.15 },
    ],
    basicPersonalAmount: 'federal',
    creditRate: 0.064,
    eligibleDividendCredit: 0.1202,
    nonEligibleDividendCredit: 0.0067,
    canadaEmploymentAmount: 1_501,
  },
};

export const QUEBEC = {
  name: 'Quebec',
  brackets: [
    { from: 0, rate: 0.14 },
    { from: 54_345, rate: 0.19 },
    { from: 108_680, rate: 0.24 },
    { from: 132_245, rate: 0.2575 },
  ] as Bracket[],
  basicPersonalAmount: 18_952,
  creditRate: 0.14,
  /** Deduction for workers: 6% of employment + self-employment income, capped. */
  workerDeduction: { rate: 0.06, max: 1_450 },
  eligibleDividendCredit: 0.117,
  nonEligibleDividendCredit: 0.0342,
} as const;

export const ONTARIO = {
  /** Surtax on basic Ontario tax (before the dividend credit). */
  surtax: [
    { threshold: 5_818, rate: 0.2 },
    { threshold: 7_446, rate: 0.36 },
  ],
  /** Ontario tax reduction: 2 x basic amount, less Ontario tax. */
  taxReductionBasicAmount: 300,
  /**
   * Ontario Health Premium on taxable income: inside each tier the premium
   * is `base + rate x (income - from)`, capped at `cap`.
   */
  healthPremium: [
    { from: 20_000, base: 0, rate: 0.06, cap: 300 },
    { from: 36_000, base: 300, rate: 0.06, cap: 450 },
    { from: 48_000, base: 450, rate: 0.25, cap: 600 },
    { from: 72_000, base: 600, rate: 0.25, cap: 750 },
    { from: 200_000, base: 750, rate: 0.25, cap: 900 },
  ],
} as const;

export const BRITISH_COLUMBIA = {
  taxReduction: { max: 690, threshold: 25_570, rate: 0.0356 },
} as const;

export const PROVINCE_NAMES: Record<ProvinceCode, string> = {
  ...Object.fromEntries(Object.entries(PROVINCES).map(([code, p]) => [code, p.name])),
  QC: QUEBEC.name,
} as Record<ProvinceCode, string>;
