import type { ProvinceCode } from './rates-2026';

export const PAY_PERIODS = ['annual', 'monthly', 'biweekly', 'weekly', 'daily', 'hourly'] as const;
export type PayPeriod = (typeof PAY_PERIODS)[number];

/** All amounts in dollars. `employmentIncome` is per `payPeriod`; every other amount is annual. */
export interface TaxInput {
  province: ProvinceCode;
  employmentIncome: number;
  payPeriod: PayPeriod;
  /** Only used for hourly pay and the hourly column of the breakdown. */
  hoursPerWeek: number;
  selfEmploymentIncome: number;
  otherIncome: number;
  capitalGains: number;
  eligibleDividends: number;
  nonEligibleDividends: number;
  rrspFhsaContributions: number;
  /** Income tax already withheld/paid (e.g. T4 box 22), compared against what's owed. */
  incomeTaxesPaid: number;
}

export interface EmployerCost {
  pensionPlan: number;
  ei: number;
  qpip: number;
  total: number;
  /** (employee deductions + employer cost) / (cash income + employer cost). */
  realTaxRate: number;
}

export interface PeriodRow {
  period: PayPeriod;
  divisor: number;
}

/** All amounts in dollars, rounded to cents. Rates are fractions (0.25 = 25%). */
export interface TaxResult {
  province: ProvinceCode;
  annualEmploymentIncome: number;
  /** What was actually received: dividends before gross-up, full capital gain. */
  totalIncome: number;
  /** Line 15000-style income: grossed-up dividends, taxable half of capital gains. */
  taxableIncome: number;
  federalTax: number;
  provincialTax: number;
  /** Already inside `provincialTax`; broken out for display. */
  ontarioHealthPremium: number;
  /** CPP outside Quebec, QPP in Quebec — employee + self-employed shares. */
  pensionPlan: number;
  pensionPlanLabel: 'CPP' | 'QPP';
  ei: number;
  qpip: number;
  incomeTax: number;
  totalTax: number;
  afterTaxIncome: number;
  /** Income tax / total income. */
  averageTaxRate: number;
  /** Income tax on the next dollar of ordinary income. */
  marginalTaxRate: number;
  /** Income tax the RRSP/FHSA deduction saves (0 when none entered). */
  rrspFhsaTaxSaving: number;
  /** Total tax (incl. CPP/QPP, EI, QPIP) / total income — the donut's split. */
  totalDeductionRate: number;
  /** incomeTaxesPaid - tax due on the return. Positive = refund, negative = owing. */
  balance: number;
  employer: EmployerCost;
  periods: PeriodRow[];
}
