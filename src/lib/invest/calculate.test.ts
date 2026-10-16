import { describe, expect, it } from 'vitest';
import { clampYears, projectInvestment } from './calculate';
import { parseInvestParams } from './params';
import type { InvestInput } from './types';

// Golden values are closed-form compound-interest results, not this engine:
// lump sum P(1+r/12)^n; end-of-month annuity c((1+i)^n - 1)/i, start-of-month
// that times (1+i).

function input(overrides: Partial<InvestInput> = {}): InvestInput {
  return {
    ...parseInvestParams({}),
    rates: [
      { rate: 0.06, on: true },
      { rate: 0.06, on: false },
      { rate: 0.06, on: false },
      { rate: 0.06, on: false },
    ],
    years: 10,
    ...overrides,
  };
}

const only = (r: ReturnType<typeof projectInvestment>) => r.projections[0];

describe('projectInvestment', () => {
  it('compounds a lump sum monthly', () => {
    const p = only(projectInvestment(input({ lumpSum: 10_000 })));
    expect(p.final.balance).toBeCloseTo(18_193.97, 2);
    expect(p.final.contributed).toBe(10_000);
    expect(p.final.growth).toBeCloseTo(8_193.97, 2);
    expect(p.rows).toHaveLength(11); // year 0..10
    expect(p.rows[0].balance).toBe(10_000);
  });

  it('end-of-month contributions match the ordinary annuity', () => {
    const p = only(projectInvestment(input({ monthly: 100 })));
    expect(p.final.balance).toBeCloseTo(16_387.93, 2);
    expect(p.final.contributed).toBe(12_000);
  });

  it('start-of-month contributions match the annuity due', () => {
    const p = only(projectInvestment(input({ monthly: 100, timing: 'start' })));
    expect(p.final.balance).toBeCloseTo(16_469.87, 2);
  });

  it('a 0% rate just sums the deposits', () => {
    const r = projectInvestment(
      input({ lumpSum: 1_000, monthly: 50, rates: input().rates.map((x) => ({ ...x, rate: 0 })) })
    );
    expect(only(r).final.balance).toBe(1_000 + 50 * 120);
    expect(only(r).final.growth).toBe(0);
  });

  it('raises the monthly contribution each year after the first', () => {
    const p = only(
      projectInvestment(
        input({ monthly: 100, contributionIncrease: 0.1, years: 2, rates: input().rates.map((x) => ({ ...x, rate: 0 })) })
      )
    );
    expect(p.rows[1].contributed).toBe(1_200);
    expect(p.rows[2].contributed).toBe(1_200 + 1_320);
  });

  it("deflates to today's dollars when showReal is on", () => {
    const nominal = only(projectInvestment(input({ lumpSum: 10_000 })));
    const real = only(projectInvestment(input({ lumpSum: 10_000, inflation: 0.02, showReal: true })));
    expect(real.final.balance).toBeCloseTo(18_193.97 / Math.pow(1.02, 10), 1);
    expect(real.final.balance).toBeLessThan(nominal.final.balance);
  });

  it('reports the first month the goal is reached', () => {
    // 10,000 at 6% doubles in month 139 (year 12).
    const p = only(projectInvestment(input({ lumpSum: 10_000, goal: 20_000, years: 20 })));
    expect(p.goalReached).toEqual({ year: 12, month: 139 });
    expect(only(projectInvestment(input({ lumpSum: 10_000, goal: 1_000_000 }))).goalReached).toBeNull();
    expect(only(projectInvestment(input({ lumpSum: 10_000, goal: 5_000 }))).goalReached).toEqual({ year: 0, month: 0 });
  });

  it('projects only enabled rates and keeps their slot', () => {
    const r = projectInvestment(
      input({
        lumpSum: 1_000,
        rates: [
          { rate: 0.04, on: false },
          { rate: 0.06, on: true },
          { rate: 0.08, on: false },
          { rate: 0.1, on: true },
        ],
      })
    );
    expect(r.projections.map((p) => p.slot)).toEqual([1, 3]);
    expect(r.projections[1].final.balance).toBeGreaterThan(r.projections[0].final.balance);
    expect(r.contributed).toHaveLength(11);
  });

  it('clamps years to 1-50', () => {
    expect(clampYears(0)).toBe(1);
    expect(clampYears(80)).toBe(50);
    expect(clampYears(Number.NaN)).toBe(1);
    expect(only(projectInvestment(input({ years: 999 }))).rows).toHaveLength(51);
  });
});
