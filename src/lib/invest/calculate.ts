import {
  MAX_YEARS,
  MIN_YEARS,
  type InvestInput,
  type InvestResult,
  type RateProjection,
  type YearRow,
} from './types';

/*
 * Month-by-month projection (P39): the annual rate compounds monthly
 * (rate / 12 per month); each month's contribution lands before (`start`)
 * or after (`end`) that month's growth; the monthly contribution rises by
 * `contributionIncrease` at the start of each year after the first. With
 * `showReal`, every reported figure is deflated to today's dollars, and the
 * goal is tested against that deflated balance. Illustration only — no
 * fees, taxes or volatility.
 */

function nonNegative(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function cents(n: number): number {
  return Math.round(n * 100) / 100;
}

export function clampYears(years: number): number {
  if (!Number.isFinite(years)) return MIN_YEARS;
  return Math.min(MAX_YEARS, Math.max(MIN_YEARS, Math.round(years)));
}

function project(input: InvestInput, slot: number, rate: number, years: number): RateProjection {
  const monthlyRate = rate / 12;
  const lumpSum = nonNegative(input.lumpSum);
  const monthly = nonNegative(input.monthly);
  const increase = nonNegative(input.contributionIncrease);
  const inflation = nonNegative(input.inflation);
  const goal = nonNegative(input.goal);
  const deflate = (months: number) => (input.showReal ? Math.pow(1 + inflation, months / 12) : 1);

  let balance = lumpSum;
  let contributed = lumpSum;
  const row = (year: number): YearRow => {
    const d = deflate(year * 12);
    return {
      year,
      balance: cents(balance / d),
      contributed: cents(contributed / d),
      growth: cents((balance - contributed) / d),
    };
  };

  const rows: YearRow[] = [row(0)];
  let goalReached: RateProjection['goalReached'] = goal > 0 && lumpSum >= goal ? { year: 0, month: 0 } : null;

  for (let month = 1; month <= years * 12; month++) {
    const yearIndex = Math.floor((month - 1) / 12);
    const deposit = monthly * Math.pow(1 + increase, yearIndex);
    if (input.timing === 'start') {
      balance = (balance + deposit) * (1 + monthlyRate);
    } else {
      balance = balance * (1 + monthlyRate) + deposit;
    }
    contributed += deposit;

    if (!goalReached && goal > 0 && balance / deflate(month) >= goal) {
      goalReached = { year: Math.ceil(month / 12), month };
    }
    if (month % 12 === 0) rows.push(row(month / 12));
  }

  return { slot, rate, rows, final: rows[rows.length - 1], goalReached };
}

export function projectInvestment(input: InvestInput): InvestResult {
  const years = clampYears(input.years);
  const projections = input.rates
    .map((r, slot) => ({ ...r, slot }))
    .filter((r) => r.on)
    .map((r) => project(input, r.slot, Math.max(0, r.rate), years));

  // Contributions don't depend on the rate; derive them once (rate 0).
  const base = project(input, -1, 0, years);
  return {
    projections,
    contributed: base.rows.map((r) => ({ year: r.year, contributed: r.contributed })),
  };
}
