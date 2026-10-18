export const RATE_SLOTS = 4;
export const MIN_YEARS = 1;
export const MAX_YEARS = 50;

export type ContributionTiming = 'start' | 'end';

export interface RateOption {
  /** Annual rate as a fraction (0.06 = 6%). */
  rate: number;
  on: boolean;
}

/** All money in dollars; rates and percentages as fractions. */
export interface InvestInput {
  lumpSum: number;
  monthly: number;
  years: number;
  /** Always RATE_SLOTS long; slot index fixes the series colour. */
  rates: RateOption[];
  /** Yearly increase applied to the monthly contribution from year 2. */
  contributionIncrease: number;
  timing: ContributionTiming;
  inflation: number;
  /** Report values in today's dollars (deflated by `inflation`). */
  showReal: boolean;
  /** 0 = no goal. */
  goal: number;
}

export interface YearRow {
  year: number;
  balance: number;
  contributed: number;
  growth: number;
}

export interface RateProjection {
  /** Index into `InvestInput.rates` — keeps colours stable when slots are toggled. */
  slot: number;
  rate: number;
  rows: YearRow[];
  final: YearRow;
  /** First point the (displayed) balance reaches the goal; null if never / no goal. */
  goalReached: { year: number; month: number } | null;
}

export interface InvestResult {
  projections: RateProjection[];
  /** Contributed-to-date per year (same for every rate). */
  contributed: { year: number; contributed: number }[];
}
