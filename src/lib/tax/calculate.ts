import {
  BRITISH_COLUMBIA,
  CAPITAL_GAINS_INCLUSION,
  CPP,
  DIVIDEND_GROSS_UP,
  EI,
  FEDERAL,
  ONTARIO,
  PROVINCES,
  QPIP,
  QPP,
  QUEBEC,
  type Bracket,
  type PersonalAmount,
  type PensionPlanRates,
} from './rates-2026';
import type { PayPeriod, PeriodRow, TaxInput, TaxResult } from './types';

/*
 * Annual (T1-return) estimate for a single filer with no credits beyond the
 * basic personal amount, CPP/QPP, EI, QPIP, the Canada employment amount and
 * the dividend tax credit. Everything is computed in dollars and rounded to
 * cents only on the way out, so rounding never compounds across steps.
 *
 * Deliberately out of scope (named in the page's disclaimer): age, pension,
 * spouse/dependant, tuition, medical and donation credits; OAS clawback;
 * AMT; refundable benefits (CWB, GST/HST credit); Ontario LIFT and the
 * smaller provincial low-income reductions (NB, NS, NL, MB, YT); Quebec's
 * health services fund contribution on non-employment income.
 */

const WEEKS_PER_YEAR = 52;
const DAYS_PER_WEEK = 5;

export const DEFAULT_HOURS_PER_WEEK = 40;

function hoursOrDefault(hoursPerWeek: number): number {
  return hoursPerWeek > 0 ? hoursPerWeek : DEFAULT_HOURS_PER_WEEK;
}

/** How many of `period` are in a year. */
export function periodsPerYear(period: PayPeriod, hoursPerWeek: number): number {
  switch (period) {
    case 'annual':
      return 1;
    case 'monthly':
      return 12;
    case 'biweekly':
      return 26;
    case 'weekly':
      return WEEKS_PER_YEAR;
    case 'daily':
      return WEEKS_PER_YEAR * DAYS_PER_WEEK;
    case 'hourly':
      return WEEKS_PER_YEAR * hoursOrDefault(hoursPerWeek);
  }
}

function nonNegative(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function cents(n: number): number {
  return Math.round(n * 100) / 100;
}

export function bracketTax(income: number, brackets: readonly Bracket[]): number {
  let tax = 0;
  for (let i = 0; i < brackets.length; i++) {
    const { from, rate } = brackets[i];
    const to = brackets[i + 1]?.from ?? Infinity;
    if (income <= from) break;
    tax += (Math.min(income, to) - from) * rate;
  }
  return tax;
}

export function personalAmount(pa: PersonalAmount, netIncome: number): number {
  const p = pa.phaseOut;
  if (!p || netIncome <= p.from) return pa.amount;
  if (netIncome >= p.to) return p.min;
  return pa.amount - ((pa.amount - p.min) * (netIncome - p.from)) / (p.to - p.from);
}

function ontarioHealthPremium(taxableIncome: number): number {
  let premium = 0;
  for (const tier of ONTARIO.healthPremium) {
    if (taxableIncome > tier.from) {
      premium = Math.min(tier.cap, tier.base + tier.rate * (taxableIncome - tier.from));
    }
  }
  return premium;
}

interface PensionSplit {
  /** Employee contributions on employment income (base + first additional + tier 2). */
  employee: number;
  /** Both halves, on self-employment income. */
  selfEmployed: number;
  /** Base portion of the employee share (incl. the SE employee half) — a credit. */
  creditBase: number;
  /** Everything else — a deduction from income. */
  deduction: number;
  /** Employer's matching contribution on employment income. */
  employer: number;
}

/**
 * The basic exemption and the YMPE/YAMPE caps apply once across employment
 * and self-employment income, employment first — the same order Schedule 8
 * uses. Self-employed earnings pay both halves.
 */
function pensionPlan(plan: PensionPlanRates, employment: number, selfEmployed: number): PensionSplit {
  const tier1 = (x: number) => Math.max(0, Math.min(x, plan.ympe) - plan.basicExemption);
  const tier2 = (x: number) => Math.max(0, Math.min(x, plan.yampe) - plan.ympe);
  const t1Rate = plan.baseRate + plan.firstAdditionalRate;

  const t1Emp = tier1(employment);
  const t1Se = tier1(employment + selfEmployed) - t1Emp;
  const t2Emp = tier2(employment);
  const t2Se = tier2(employment + selfEmployed) - t2Emp;

  const employee = t1Emp * t1Rate + t2Emp * plan.secondAdditionalRate;
  const selfEmployedTotal = 2 * (t1Se * t1Rate + t2Se * plan.secondAdditionalRate);
  const creditBase = (t1Emp + t1Se) * plan.baseRate;

  return {
    employee,
    selfEmployed: selfEmployedTotal,
    creditBase,
    deduction: employee + selfEmployedTotal - creditBase,
    employer: employee,
  };
}

interface Core {
  federalTax: number;
  provincialTax: number;
  ontarioHealthPremium: number;
  incomeTax: number;
  taxableIncome: number;
  pension: PensionSplit;
  ei: number;
  qpipEmployee: number;
  qpipSelfEmployed: number;
}

function computeCore(input: TaxInput, annualEmployment: number): Core {
  const isQuebec = input.province === 'QC';
  const employment = annualEmployment;
  const selfEmployed = nonNegative(input.selfEmploymentIncome);
  const eligible = nonNegative(input.eligibleDividends) * DIVIDEND_GROSS_UP.eligible;
  const nonEligible = nonNegative(input.nonEligibleDividends) * DIVIDEND_GROSS_UP.nonEligible;

  const totalIncome =
    employment +
    selfEmployed +
    nonNegative(input.otherIncome) +
    nonNegative(input.capitalGains) * CAPITAL_GAINS_INCLUSION +
    eligible +
    nonEligible;

  const pension = pensionPlan(isQuebec ? QPP : CPP, employment, selfEmployed);
  const ei = Math.min(employment, EI.maxInsurableEarnings) * (isQuebec ? EI.quebecRate : EI.rate);

  // QPIP: employees pay the employee rate; self-employed earnings pay the
  // self-employed rate, of which the employee-rate share is a credit and
  // the rest a deduction (mirrors the CPP split).
  let qpipEmployee = 0;
  let qpipSelfEmployed = 0;
  if (isQuebec) {
    const insuredEmp = Math.min(employment, QPIP.maxInsurableEarnings);
    const insuredSe = Math.min(employment + selfEmployed, QPIP.maxInsurableEarnings) - insuredEmp;
    qpipEmployee = insuredEmp * QPIP.employeeRate;
    qpipSelfEmployed = insuredSe * QPIP.selfEmployedRate;
  }
  const qpipSeCredit = (qpipSelfEmployed * QPIP.employeeRate) / QPIP.selfEmployedRate;
  const qpipSeDeduction = qpipSelfEmployed - qpipSeCredit;

  const commonDeductions =
    nonNegative(input.rrspFhsaContributions) + pension.deduction + qpipSeDeduction;
  const netIncome = Math.max(0, totalIncome - commonDeductions);

  // Federal
  const federalCredits =
    personalAmount(FEDERAL.basicPersonalAmount, netIncome) +
    pension.creditBase +
    ei +
    qpipEmployee +
    qpipSeCredit +
    Math.min(FEDERAL.canadaEmploymentAmount, employment);
  const federalDtc =
    eligible * FEDERAL.eligibleDividendCredit + nonEligible * FEDERAL.nonEligibleDividendCredit;
  const basicFederal = Math.max(
    0,
    bracketTax(netIncome, FEDERAL.brackets) - federalCredits * FEDERAL.creditRate - federalDtc
  );
  const federalTax = isQuebec ? basicFederal * (1 - FEDERAL.quebecAbatement) : basicFederal;

  let provincialTax: number;
  let healthPremium = 0;
  let taxableIncome = netIncome;

  if (input.province === 'QC') {
    // Quebec folded its QPP/EI/QPIP credits into the basic amount in 2011,
    // so there are none here — but it has its own deduction for workers.
    const workerDeduction = Math.min(
      QUEBEC.workerDeduction.max,
      (employment + selfEmployed) * QUEBEC.workerDeduction.rate
    );
    taxableIncome = Math.max(0, netIncome - workerDeduction);
    const dtc =
      eligible * QUEBEC.eligibleDividendCredit + nonEligible * QUEBEC.nonEligibleDividendCredit;
    provincialTax = Math.max(
      0,
      bracketTax(taxableIncome, QUEBEC.brackets) - QUEBEC.basicPersonalAmount * QUEBEC.creditRate - dtc
    );
  } else {
    const prov = PROVINCES[input.province];
    const bpa =
      prov.basicPersonalAmount === 'federal'
        ? personalAmount(FEDERAL.basicPersonalAmount, netIncome)
        : personalAmount(prov.basicPersonalAmount, netIncome);
    const credits =
      (bpa +
        pension.creditBase +
        ei +
        (prov.canadaEmploymentAmount ? Math.min(prov.canadaEmploymentAmount, employment) : 0)) *
      prov.creditRate;
    const dtc =
      eligible * prov.eligibleDividendCredit + nonEligible * prov.nonEligibleDividendCredit;
    const basic = Math.max(0, bracketTax(netIncome, prov.brackets) - credits);

    if (input.province === 'ON') {
      // ON428: surtax on basic tax before the dividend credit; then the tax
      // reduction; the health premium sits outside both.
      const surtax = ONTARIO.surtax.reduce(
        (acc, s) => acc + Math.max(0, basic - s.threshold) * s.rate,
        0
      );
      const afterDtc = Math.max(0, basic + surtax - dtc);
      const reduction = Math.max(
        0,
        Math.min(afterDtc, 2 * ONTARIO.taxReductionBasicAmount - afterDtc)
      );
      healthPremium = ontarioHealthPremium(netIncome);
      provincialTax = afterDtc - reduction + healthPremium;
    } else if (input.province === 'BC') {
      const r = BRITISH_COLUMBIA.taxReduction;
      const reduction = Math.max(0, r.max - Math.max(0, netIncome - r.threshold) * r.rate);
      provincialTax = Math.max(0, basic - dtc - reduction);
    } else {
      provincialTax = Math.max(0, basic - dtc);
    }
  }

  return {
    federalTax,
    provincialTax,
    ontarioHealthPremium: healthPremium,
    incomeTax: federalTax + provincialTax,
    taxableIncome,
    pension,
    ei,
    qpipEmployee,
    qpipSelfEmployed,
  };
}

/** Marginal rate is measured on this much extra ordinary ("other") income. */
const MARGINAL_STEP = 100;

const BREAKDOWN_PERIODS: PayPeriod[] = ['annual', 'monthly', 'biweekly', 'weekly', 'daily', 'hourly'];

export function calculateTax(input: TaxInput): TaxResult {
  const isQuebec = input.province === 'QC';
  const annualEmployment =
    nonNegative(input.employmentIncome) * periodsPerYear(input.payPeriod, input.hoursPerWeek);

  const core = computeCore(input, annualEmployment);
  const withoutRrsp =
    nonNegative(input.rrspFhsaContributions) > 0
      ? computeCore({ ...input, rrspFhsaContributions: 0 }, annualEmployment)
      : core;
  const bumped = computeCore(
    { ...input, otherIncome: nonNegative(input.otherIncome) + MARGINAL_STEP },
    annualEmployment
  );

  const totalIncome =
    annualEmployment +
    nonNegative(input.selfEmploymentIncome) +
    nonNegative(input.otherIncome) +
    nonNegative(input.capitalGains) +
    nonNegative(input.eligibleDividends) +
    nonNegative(input.nonEligibleDividends);

  const pensionTotal = core.pension.employee + core.pension.selfEmployed;
  const qpipTotal = core.qpipEmployee + core.qpipSelfEmployed;
  const totalTax = core.incomeTax + pensionTotal + core.ei + qpipTotal;

  // Employee CPP/EI/QPIP are withheld at source; self-employed contributions
  // and income tax are settled on the return.
  const dueOnReturn = core.incomeTax + core.pension.selfEmployed + core.qpipSelfEmployed;

  const employerPension = core.pension.employer;
  const employerEi = core.ei * EI.employerMultiplier;
  const employerQpip = isQuebec
    ? Math.min(annualEmployment, QPIP.maxInsurableEarnings) * QPIP.employerRate
    : 0;
  const employerTotal = employerPension + employerEi + employerQpip;

  const periods: PeriodRow[] = BREAKDOWN_PERIODS.map((period) => ({
    period,
    divisor: periodsPerYear(period, input.hoursPerWeek),
  }));

  return {
    province: input.province,
    annualEmploymentIncome: cents(annualEmployment),
    totalIncome: cents(totalIncome),
    taxableIncome: cents(core.taxableIncome),
    federalTax: cents(core.federalTax),
    provincialTax: cents(core.provincialTax),
    ontarioHealthPremium: cents(core.ontarioHealthPremium),
    pensionPlan: cents(pensionTotal),
    pensionPlanLabel: isQuebec ? 'QPP' : 'CPP',
    ei: cents(core.ei),
    qpip: cents(qpipTotal),
    incomeTax: cents(core.incomeTax),
    totalTax: cents(totalTax),
    afterTaxIncome: cents(totalIncome - totalTax),
    averageTaxRate: totalIncome > 0 ? core.incomeTax / totalIncome : 0,
    marginalTaxRate: (bumped.incomeTax - core.incomeTax) / MARGINAL_STEP,
    rrspFhsaTaxSaving: cents(withoutRrsp.incomeTax - core.incomeTax),
    totalDeductionRate: totalIncome > 0 ? totalTax / totalIncome : 0,
    // `+ 0` normalises -0, so paying exactly what's due shows $0, not -$0.
    balance: cents(nonNegative(input.incomeTaxesPaid) - dueOnReturn) + 0,
    employer: {
      pensionPlan: cents(employerPension),
      ei: cents(employerEi),
      qpip: cents(employerQpip),
      total: cents(employerTotal),
      realTaxRate:
        totalIncome + employerTotal > 0
          ? (totalTax + employerTotal) / (totalIncome + employerTotal)
          : 0,
    },
    periods,
  };
}
