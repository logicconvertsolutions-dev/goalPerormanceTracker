import { calculateTax } from '@/lib/tax/calculate';
import type { ProvinceCode } from '@/lib/tax/rates-2026';
import { formatMoney } from '@/lib/tax/format';
import {
  DEBT_KIND_LABELS,
  type Debt,
  type DebtResult,
  type Frequency,
  type Household,
  type InsuranceGap,
  type PersonMoney,
  type RoomWarning,
  type Summary,
} from './types';

/** Rate at or above which a debt is flagged and paid down first. */
export const HIGH_INTEREST_PCT = 10;
/** Credit-card minimum payment estimate when none is entered. */
export const CARD_MIN_PCT = 0.03;
export const CARD_MIN_FLOOR = 10;
/** Full CESG: 20% of the first $2,500 a year per child. */
export const RESP_GRANT_CONTRIBUTION = 2_500;

const PER_MONTH: Record<Frequency, number> = {
  weekly: 52 / 12,
  biweekly: 26 / 12,
  semimonthly: 2,
  monthly: 1,
  annual: 1 / 12,
};

/** Cents, and never -0 (P40: "$0", not "-$0"). */
export function round2(n: number): number {
  return Math.round(n * 100) / 100 + 0;
}

function pos(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Any amount at its frequency -> per month (bi-weekly is ×26/12, not ×2). */
export function toMonthly(amount: number, frequency: Frequency): number {
  return pos(amount) * PER_MONTH[frequency];
}

export function personNetMonthly(p: PersonMoney): number {
  return toMonthly(p.net, p.netFrequency) + toMonthly(p.other, p.otherFrequency);
}

function personSavingsMonthly(p: PersonMoney): number {
  return pos(p.rrsp.monthly) + pos(p.tfsa.monthly) + pos(p.fhsa.monthly) + pos(p.nonRegMonthly);
}

function personAssets(p: PersonMoney): number {
  return (
    pos(p.rrsp.balance) +
    pos(p.tfsa.balance) +
    pos(p.fhsa.balance) +
    pos(p.nonRegBalance) +
    pos(p.cash)
  );
}

/** Mortgages compound semi-annually in Canada; everything else monthly. */
export function monthlyRate(debt: Pick<Debt, 'kind' | 'ratePct'>): number {
  const annual = pos(debt.ratePct) / 100;
  if (debt.kind === 'mortgage') return Math.pow(1 + annual / 2, 1 / 6) - 1;
  return annual / 12;
}

/** Level payment that clears `balance` in `months` at monthly rate `r`. */
export function amortizedPayment(balance: number, r: number, months: number): number {
  if (balance <= 0 || months <= 0) return 0;
  if (r === 0) return balance / months;
  return (balance * r) / (1 - Math.pow(1 + r, -months));
}

/**
 * The monthly payment to assume when none is entered: a card's ~3% minimum,
 * interest-only on a line of credit, an amortized payment when a term is
 * known, otherwise nothing.
 */
export function estimatePayment(debt: Debt): number {
  const balance = pos(debt.balance);
  if (balance === 0) return 0;
  const r = monthlyRate(debt);
  switch (debt.kind) {
    case 'card':
      return Math.min(balance, Math.max(balance * CARD_MIN_PCT, CARD_MIN_FLOOR));
    case 'loc':
      return balance * r;
    default:
      return amortizedPayment(balance, r, Math.round(pos(debt.termYears) * 12));
  }
}

/** Months to clear `balance` paying `payment`; null when it never clears. */
export function payoff(
  balance: number,
  r: number,
  payment: number
): { months: number; totalInterest: number } | null {
  if (balance <= 0) return { months: 0, totalInterest: 0 };
  if (payment <= 0) return null;
  if (r === 0) return { months: Math.ceil(balance / payment - 1e-9), totalInterest: 0 };
  if (payment <= balance * r + 1e-9) return null;
  const n = -Math.log(1 - (r * balance) / payment) / Math.log(1 + r);
  return { months: Math.ceil(n - 1e-9), totalInterest: Math.max(0, n * payment - balance) };
}

export function analyzeDebt(debt: Debt): DebtResult {
  const balance = pos(debt.balance);
  const r = monthlyRate(debt);
  const entered = pos(debt.monthlyPayment);
  const payment = entered > 0 ? entered : estimatePayment(debt);
  const result = payoff(balance, r, payment);
  return {
    payment: round2(payment),
    estimated: entered === 0 && balance > 0,
    monthlyInterest: round2(balance * r),
    highInterest: balance > 0 && pos(debt.ratePct) >= HIGH_INTEREST_PCT,
    payoffMonths: result ? result.months : null,
    totalInterest: result ? round2(result.totalInterest) : null,
  };
}

/** Months from today's month (inclusive) to December. */
export function monthsLeftInYear(today: Date): number {
  return 12 - today.getMonth();
}

function roomWarnings(h: Household, today: Date): RoomWarning[] {
  const out: RoomWarning[] = [];
  const left = monthsLeftInYear(today);
  const people: ['client' | 'spouse', PersonMoney | null][] = [
    ['client', h.client],
    ['spouse', h.spouse],
  ];
  for (const [person, p] of people) {
    if (!p) continue;
    for (const [account, acc] of [
      ['RRSP', p.rrsp],
      ['TFSA', p.tfsa],
      ['FHSA', p.fhsa],
    ] as const) {
      const room = pos(acc.room);
      const projected = pos(acc.monthly) * left;
      if (room > 0 && projected > room + 0.005) {
        out.push({
          person,
          account,
          projected: round2(projected),
          room: round2(room),
          over: round2(projected - room),
        });
      }
    }
  }
  return out;
}

export function summarize(h: Household, today: Date = new Date()): Summary {
  const people = h.spouse ? [h.client, h.spouse] : [h.client];

  const totalNetIncome = people.reduce((s, p) => s + personNetMonthly(p), 0) + pos(h.ccbMonthly);
  const savingsMonthly =
    people.reduce((s, p) => s + personSavingsMonthly(p), 0) +
    h.children.reduce((s, c) => s + pos(c.respMonthly), 0);
  const netAfterSavings = totalNetIncome - savingsMonthly;

  const debts = h.debts.map(analyzeDebt);
  const debtPayments = debts.reduce((s, d) => s + d.payment, 0);
  const expenseLines = h.expenses.reduce((s, e) => s + toMonthly(e.amount, e.frequency), 0);
  const essentialLines = h.expenses
    .filter((e) => e.essential)
    .reduce((s, e) => s + toMonthly(e.amount, e.frequency), 0);
  const totalExpenses = expenseLines + debtPayments;
  // Debt payments are commitments, so they count as essential spending.
  const essentialMonthly = essentialLines + debtPayments;

  const liquid = people.reduce((s, p) => s + pos(p.cash), 0);
  const assets =
    people.reduce((s, p) => s + personAssets(p), 0) +
    h.children.reduce((s, c) => s + pos(c.respBalance), 0) +
    pos(h.homeValue);
  const liabilities = h.debts.reduce((s, d) => s + pos(d.balance), 0);

  // Life insurance need, per person: clear every debt, replace that
  // person's take-home pay for N years, fund each child's education. Less
  // existing cover and what the family could use right away (cash, TFSA,
  // non-registered — not RRSP/FHSA, which are taxed or restricted).
  const accessible = people.reduce(
    (s, p) => s + pos(p.cash) + pos(p.tfsa.balance) + pos(p.nonRegBalance),
    0
  );
  const insurance: InsuranceGap[] = (
    [
      ['client', h.client],
      ['spouse', h.spouse],
    ] as const
  )
    .filter((entry): entry is ['client' | 'spouse', PersonMoney] => entry[1] !== null)
    .map(([person, p]) => {
      const need =
        liabilities +
        pos(h.incomeReplacementYears) * 12 * personNetMonthly(p) +
        pos(h.educationPerChild) * h.children.length;
      const have = pos(p.groupLife) + pos(p.personalLife) + accessible;
      return { person, need: round2(need), have: round2(have), gap: round2(Math.max(0, need - have)) };
    });

  return {
    totalNetIncome: round2(totalNetIncome),
    savingsMonthly: round2(savingsMonthly),
    netAfterSavings: round2(netAfterSavings),
    debtPayments: round2(debtPayments),
    expenseLines: round2(expenseLines),
    totalExpenses: round2(totalExpenses),
    balance: round2(netAfterSavings - totalExpenses),
    essentialMonthly: round2(essentialMonthly),
    liquid: round2(liquid),
    emergencyMonths: essentialMonthly > 0 ? liquid / essentialMonthly : null,
    assets: round2(assets),
    liabilities: round2(liabilities),
    netWorth: round2(assets - liabilities),
    savingsRate: totalNetIncome > 0 ? savingsMonthly / totalNetIncome : null,
    debts,
    roomWarnings: roomWarnings(h, today),
    insurance,
  };
}

/** Whole months from today's month to "YYYY-MM"; null if blank or not in the future. */
export function monthsUntil(targetMonth: string, today: Date = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})$/.exec(targetMonth);
  if (!m) return null;
  const months = (Number(m[1]) - today.getFullYear()) * 12 + (Number(m[2]) - 1 - today.getMonth());
  return months >= 1 ? months : null;
}

/** Monthly amount to put aside (no growth assumed) to reach a goal on time. */
export function goalMonthly(amount: number, targetMonth: string, today: Date = new Date()) {
  const months = monthsUntil(targetMonth, today);
  if (!months || pos(amount) === 0) return null;
  return { months, monthly: round2(pos(amount) / months) };
}

/** Age in whole years on `today` from "YYYY-MM-DD"; null if blank/invalid/future. */
export function ageOn(dob: string, today: Date = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let age = today.getFullYear() - y;
  if (today.getMonth() + 1 < mo || (today.getMonth() + 1 === mo && today.getDate() < d)) age--;
  return age >= 0 && age < 130 ? age : null;
}

export interface TaxEstimate {
  netMonthly: number;
  marginalRate: number;
  /** Income tax the year's RRSP + FHSA contributions save. */
  rrspFhsaSaving: number;
}

/**
 * Take-home pay, marginal rate and RRSP/FHSA saving for a salaried
 * person, from the Tax Calculator's own engine so the two tools agree.
 */
export function estimateTax(
  grossAnnual: number,
  province: ProvinceCode,
  rrspFhsaAnnual = 0
): TaxEstimate | null {
  if (pos(grossAnnual) === 0) return null;
  const t = calculateTax({
    province,
    employmentIncome: pos(grossAnnual),
    payPeriod: 'annual',
    hoursPerWeek: 40,
    selfEmploymentIncome: 0,
    otherIncome: 0,
    capitalGains: 0,
    eligibleDividends: 0,
    nonEligibleDividends: 0,
    rrspFhsaContributions: pos(rrspFhsaAnnual),
    incomeTaxesPaid: 0,
  });
  return {
    netMonthly: round2(t.afterTaxIncome / 12),
    marginalRate: t.marginalTaxRate,
    rrspFhsaSaving: t.rrspFhsaTaxSaving,
  };
}

export interface SuggestionContext {
  names: { client: string; spouse: string };
  /** The client's marginal tax rate, when a gross income is known. */
  marginalRate: number | null;
  debtLabels: string[];
  /** Form row ids, so a debt's recommendation id survives edits and reordering. */
  debtIds?: string[];
}

/** One automatic recommendation; `id` is stable while the situation lasts, so a note can hang off it. */
export interface Suggestion {
  id: string;
  text: string;
}

const whole = (n: number) => formatMoney(n, { whole: true });

/**
 * Plain-language next steps, in the order an agent would raise them. This
 * is a conversation guide, not advice — the page says so.
 */
export function suggestions(h: Household, s: Summary, ctx: SuggestionContext): Suggestion[] {
  const out: Suggestion[] = [];
  const add = (id: string, text: string) => out.push({ id, text });
  const who = (p: 'client' | 'spouse') => ctx.names[p] || (p === 'client' ? 'Client' : 'Spouse');

  if (s.balance < 0) {
    add(
      'shortfall',
      `Spending is ${whole(-s.balance)} a month more than take-home pay after savings. Review expenses before adding new commitments.`
    );
  }

  h.debts
    .map((d, i) => ({
      d,
      r: s.debts[i],
      id: `debt:${ctx.debtIds?.[i] ?? i}`,
      label: ctx.debtLabels[i] || DEBT_KIND_LABELS[d.kind],
    }))
    .filter((x) => x.r.highInterest)
    .sort((a, b) => b.d.ratePct - a.d.ratePct)
    .forEach(({ d, r, id, label }) => {
      add(
        id,
        `Pay down the ${label} (${d.ratePct}%) first. It costs about ${whole(r.monthlyInterest)} a month in interest.`
      );
    });

  if (s.emergencyMonths !== null && s.emergencyMonths < 3) {
    add(
      'emergency',
      `Build an emergency fund of 3–6 months of essential spending (${whole(s.essentialMonthly * 3)}–${whole(s.essentialMonthly * 6)}). Chequing/savings covers ${s.emergencyMonths.toFixed(1)} months now.`
    );
  }

  for (const g of s.insurance) {
    if (g.gap > 0) {
      add(
        `insurance:${g.person}`,
        `${who(g.person)}: estimated life-insurance gap of ${whole(g.gap)}. Group cover through work usually ends when the job does.`
      );
    }
  }

  for (const w of s.roomWarnings) {
    add(
      `room:${w.person}:${w.account}`,
      `${who(w.person)}'s ${w.account} contributions would go ${whole(w.over)} over the room left this year. Over-contributions are penalized.`
    );
  }

  const people = (
    [
      ['client', h.client],
      ['spouse', h.spouse],
    ] as const
  ).filter((e) => e[1] !== null);
  const hasMortgage = h.debts.some((d) => d.kind === 'mortgage' && d.balance > 0);
  if (!hasMortgage) {
    for (const [person, p] of people) {
      if (p && p.fhsa.room > 0 && p.fhsa.monthly === 0) {
        add(
          `fhsa:${person}`,
          `${who(person)} has FHSA room. Contributions are deductible like an RRSP and tax-free for a first home.`
        );
      }
    }
  }

  const grantMonthly = RESP_GRANT_CONTRIBUTION / 12;
  if (h.children.some((c) => c.respMonthly + 0.005 < grantMonthly)) {
    add(
      'resp',
      `RESP: ${whole(RESP_GRANT_CONTRIBUTION)} a year (${formatMoney(grantMonthly)}/month) per child earns the full $500 CESG grant.`
    );
  }

  if (s.balance > 0 && ctx.marginalRate !== null) {
    add(
      'registered-choice',
      ctx.marginalRate >= 0.3
        ? `At a ${Math.round(ctx.marginalRate * 100)}% marginal rate, RRSP contributions give a larger refund. Consider RRSP before TFSA for the ${whole(s.balance)}/month left over.`
        : `At a ${Math.round(ctx.marginalRate * 100)}% marginal rate, a TFSA is usually the better first choice for the ${whole(s.balance)}/month left over.`
    );
  }

  return out;
}
