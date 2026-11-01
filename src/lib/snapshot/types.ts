import type { ProvinceCode } from '@/lib/tax/rates-2026';

/*
 * Client Financial Snapshot (P43): the agent's intake template — household,
 * income, savings, insurance, debts, expenses, goals — as numbers. All
 * money in dollars (like lib/tax and lib/invest; nothing here reaches the
 * database). Browser-only: see lib/snapshot/form.ts for how it's kept.
 */

export const FREQUENCIES = ['weekly', 'biweekly', 'semimonthly', 'monthly', 'annual'] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  weekly: 'Weekly',
  biweekly: 'Every 2 weeks',
  semimonthly: 'Twice a month',
  monthly: 'Monthly',
  annual: 'Yearly',
};

/** A registered account the template tracks balance, room and contribution for. */
export interface RoomAccount {
  balance: number;
  /** Contribution room left (0 = not entered). */
  room: number;
  monthly: number;
}

/** Pay frequencies a payroll deduction can be quoted in. */
export const PAY_FREQUENCIES = ['weekly', 'biweekly', 'semimonthly', 'monthly'] as const;
export type PayFrequency = (typeof PAY_FREQUENCIES)[number];

export const PAYROLL_KINDS = [
  'group-rrsp',
  'pension',
  'union-dues',
  'benefits',
  'espp',
  'other-pre',
  'other-after',
] as const;
export type PayrollKind = (typeof PAYROLL_KINDS)[number];

/**
 * How each workplace deduction behaves (P43c). Pre-tax deductions come off
 * the cheque before tax is withheld, so the tax saving is already in every
 * pay and there's no refund for them at tax time; after-tax ones don't
 * change tax at all.
 */
export const PAYROLL_INFO: Record<
  PayrollKind,
  { label: string; preTax: boolean; savings: boolean; rrspRoom: boolean; employerMatch: boolean }
> = {
  'group-rrsp': { label: 'Group RRSP', preTax: true, savings: true, rrspRoom: true, employerMatch: true },
  pension: { label: 'Pension plan (RPP)', preTax: true, savings: true, rrspRoom: false, employerMatch: true },
  'union-dues': { label: 'Union / professional dues', preTax: true, savings: false, rrspRoom: false, employerMatch: false },
  benefits: { label: 'Health / dental / life premiums', preTax: false, savings: false, rrspRoom: false, employerMatch: false },
  espp: { label: 'Share purchase / after-tax savings', preTax: false, savings: true, rrspRoom: false, employerMatch: true },
  'other-pre': { label: 'Other (before tax)', preTax: true, savings: false, rrspRoom: false, employerMatch: false },
  'other-after': { label: 'Other (after tax)', preTax: false, savings: false, rrspRoom: false, employerMatch: false },
};

export interface PayrollDeduction {
  kind: PayrollKind;
  /** Taken from the employee's pay, per pay period. */
  amount: number;
  /** What the employer adds on top, per pay period (match / DPSP / pension share). */
  employer: number;
}

export interface PersonMoney {
  grossAnnual: number;
  /**
   * auto: net income is the calculated deposit from gross (tax + payroll
   * deductions); manual: the typed `net` at `netFrequency` (e.g. the actual
   * bi-weekly deposit).
   */
  netMode: 'auto' | 'manual';
  net: number;
  netFrequency: Frequency;
  payFrequency: PayFrequency;
  payroll: PayrollDeduction[];
  other: number;
  otherFrequency: Frequency;
  rrsp: RoomAccount;
  tfsa: RoomAccount;
  fhsa: RoomAccount;
  nonRegBalance: number;
  nonRegMonthly: number;
  cash: number;
  groupLife: number;
  personalLife: number;
}

export interface ChildMoney {
  respBalance: number;
  respMonthly: number;
}

export const DEBT_KINDS = ['card', 'loc', 'car', 'mortgage', 'other'] as const;
export type DebtKind = (typeof DEBT_KINDS)[number];

export const DEBT_KIND_LABELS: Record<DebtKind, string> = {
  card: 'Credit card',
  loc: 'Line of credit',
  car: 'Car loan',
  mortgage: 'Mortgage',
  other: 'Other loan / debt',
};

export interface Debt {
  kind: DebtKind;
  balance: number;
  /** Annual rate as a percentage (19.99 = 19.99%). */
  ratePct: number;
  /** Remaining amortization in years (car loan / mortgage). */
  termYears: number;
  /** Actual monthly payment; 0 = not entered, an estimate is used. */
  monthlyPayment: number;
}

export interface ExpenseLine {
  amount: number;
  frequency: Frequency;
  essential: boolean;
  /** Life / health insurance premiums: counts toward the 5% protection set-aside. */
  protection: boolean;
}

export interface Goal {
  amount: number;
  /** "YYYY-MM" or "" */
  targetMonth: string;
}

export interface Household {
  /** Drives the take-home estimate for people whose net income is auto. */
  province: ProvinceCode;
  client: PersonMoney;
  spouse: PersonMoney | null;
  children: ChildMoney[];
  /** Canada Child Benefit, per month. */
  ccbMonthly: number;
  homeValue: number;
  debts: Debt[];
  expenses: ExpenseLine[];
  goals: Goal[];
  /** Years of a person's net income life insurance should replace. */
  incomeReplacementYears: number;
  /** Education fund to set aside per child in the insurance need. */
  educationPerChild: number;
}

export interface DebtResult {
  /** Payment used in the totals: the entered one, else the estimate. */
  payment: number;
  estimated: boolean;
  monthlyInterest: number;
  highInterest: boolean;
  /** Months to pay off at `payment`; null = never (payment ≤ interest). */
  payoffMonths: number | null;
  totalInterest: number | null;
}

export interface RoomWarning {
  person: 'client' | 'spouse';
  account: 'RRSP' | 'TFSA' | 'FHSA';
  /** Contributions still to come this calendar year at the current rate. */
  projected: number;
  room: number;
  over: number;
}

export interface InsuranceGap {
  person: 'client' | 'spouse';
  need: number;
  have: number;
  /** need − have, never below 0. */
  gap: number;
}

export interface Summary {
  totalNetIncome: number;
  savingsMonthly: number;
  netAfterSavings: number;
  debtPayments: number;
  expenseLines: number;
  totalExpenses: number;
  balance: number;
  essentialMonthly: number;
  liquid: number;
  /** Liquid savings ÷ essential monthly spend; null when nothing is essential. */
  emergencyMonths: number | null;
  assets: number;
  liabilities: number;
  netWorth: number;
  /** (bank savings + saved through work) ÷ (net income + saved through work); null without income. */
  savingsRate: number | null;
  /** Payroll savings that never reach the bank: group RRSP, pension, ESPP, employer matches. Monthly. */
  savedThroughWork: number;
  /** 5% of total net income, monthly. */
  protectionTarget: number;
  /** Insurance premiums already in expenses (protection lines), monthly. */
  protectionCurrent: number;
  /** max(0, target − current). */
  protectionGap: number;
  /** balance − protectionGap: informational, the Balance Amount is unchanged. */
  balanceAfterProtection: number;
  debts: DebtResult[];
  roomWarnings: RoomWarning[];
  insurance: InsuranceGap[];
}
