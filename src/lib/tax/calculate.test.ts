import { describe, expect, it } from 'vitest';
import { bracketTax, calculateTax, periodsPerYear } from './calculate';
import { FEDERAL, PROVINCES, QUEBEC, type ProvinceCode } from './rates-2026';
import type { TaxInput } from './types';

// Golden values come from published 2026 tables, not from this engine:
// Raymond Chabot Grant Thornton "Individual taxation - Quebec - 2026"
// (Tables I1 tax table, I3 combined top marginal rates) and CRA T4127
// Tables 8.3-8.8 (CPP/QPP/EI/QPIP maximums). If a test here fails after a
// rate edit, the rate file is wrong, not the test.

function input(overrides: Partial<TaxInput> = {}): TaxInput {
  return {
    province: 'ON',
    employmentIncome: 0,
    payPeriod: 'annual',
    hoursPerWeek: 40,
    selfEmploymentIncome: 0,
    otherIncome: 0,
    capitalGains: 0,
    eligibleDividends: 0,
    nonEligibleDividends: 0,
    rrspFhsaContributions: 0,
    incomeTaxesPaid: 0,
    ...overrides,
  };
}

/** Within a dollar — the published tables round to whole dollars. */
function expectDollars(actual: number, expected: number) {
  expect(Math.abs(actual - expected)).toBeLessThan(1);
}

describe('rate tables', () => {
  // T4127 Table 8.1 prints a cumulative constant per bracket; recomputing it
  // from the thresholds catches a mistyped threshold or rate.
  it('federal brackets reproduce T4127 constants', () => {
    const k = [0, 3_804, 10_241, 15_685, 26_024];
    let acc = 0;
    FEDERAL.brackets.forEach((b, i) => {
      if (i > 0) acc += (b.rate - FEDERAL.brackets[i - 1].rate) * b.from;
      expect(Math.round(acc)).toBe(k[i]);
    });
  });

  it('every jurisdiction has ascending brackets starting at 0', () => {
    for (const p of [...Object.values(PROVINCES), QUEBEC]) {
      expect(p.brackets[0].from).toBe(0);
      for (let i = 1; i < p.brackets.length; i++) {
        expect(p.brackets[i].from).toBeGreaterThan(p.brackets[i - 1].from);
        expect(p.brackets[i].rate).toBeGreaterThan(p.brackets[i - 1].rate);
      }
    }
  });

  it('bracketTax sums each slice', () => {
    expect(bracketTax(0, FEDERAL.brackets)).toBe(0);
    expect(bracketTax(58_523, FEDERAL.brackets)).toBeCloseTo(8_193.22, 2);
    expect(bracketTax(117_045, FEDERAL.brackets)).toBeCloseTo(20_190.23, 2);
  });
});

describe('Quebec tax table (RCGT Table I1, taxable income only)', () => {
  it.each([
    [20_000, 415, 147],
    [50_000, 3_922, 4_347],
    [100_000, 12_018, 13_629],
    [250_000, 45_686, 51_256],
    [300_000, 59_201, 64_131],
  ])('%i -> federal %i, Quebec %i', (income, federal, quebec) => {
    const r = calculateTax(input({ province: 'QC', otherIncome: income }));
    expectDollars(r.federalTax, federal);
    expectDollars(r.provincialTax, quebec);
  });

  it.each([
    [30_000, 0.2569],
    [60_000, 0.3612],
    [120_000, 0.4571],
  ])('marginal rate at %i is %f', (income, rate) => {
    const r = calculateTax(input({ province: 'QC', otherIncome: income }));
    expect(r.marginalTaxRate).toBeCloseTo(rate, 4);
  });
});

describe('combined top marginal rates (RCGT Table I3)', () => {
  // [ordinary income, eligible dividends, non-eligible dividends], per $1 actually received.
  const TOP: Record<ProvinceCode, [number, number, number]> = {
    // RCGT prints 42.30 for AB non-eligible; GEIB's 2026 rate card and
    // Raymond James' AB Budget 2026 summary both print 42.31 (2.18% DTC).
    AB: [48.0, 34.31, 42.31],
    BC: [53.5, 36.54, 48.89],
    MB: [50.4, 37.78, 46.67],
    NB: [52.5, 32.4, 46.83],
    NL: [54.8, 46.2, 48.96],
    NT: [47.05, 28.33, 36.82],
    NS: [54.0, 41.58, 49.99],
    NU: [44.5, 33.08, 37.79],
    ON: [53.53, 39.34, 47.74],
    PE: [53.0, 37.92, 49.07],
    QC: [53.31, 40.11, 48.7],
    SK: [47.5, 29.64, 41.34],
    YT: [48.0, 28.93, 44.04],
  };
  const BASE = 2_000_000;
  const STEP = 1_000;

  function rateOn(province: ProvinceCode, field: keyof TaxInput) {
    const base = input({ province, otherIncome: BASE });
    const before = calculateTax(base).incomeTax;
    const after = calculateTax({ ...base, [field]: (base[field] as number) + STEP }).incomeTax;
    return ((after - before) / STEP) * 100;
  }

  it.each(Object.entries(TOP) as [ProvinceCode, [number, number, number]][])(
    '%s',
    (province, [ordinary, eligible, nonEligible]) => {
      expect(Math.abs(rateOn(province, 'otherIncome') - ordinary)).toBeLessThan(0.006);
      expect(Math.abs(rateOn(province, 'eligibleDividends') - eligible)).toBeLessThan(0.006);
      expect(Math.abs(rateOn(province, 'nonEligibleDividends') - nonEligible)).toBeLessThan(0.006);
    }
  );
});

describe('payroll contributions (T4127 Tables 8.3-8.8)', () => {
  it('caps CPP, CPP2 and EI outside Quebec', () => {
    const r = calculateTax(input({ employmentIncome: 120_000 }));
    expect(r.pensionPlanLabel).toBe('CPP');
    expect(r.pensionPlan).toBe(4_646.45);
    expect(r.ei).toBe(1_123.07);
    expect(r.qpip).toBe(0);
    expect(r.employer.pensionPlan).toBe(4_646.45);
    expect(r.employer.ei).toBe(1_572.3);
  });

  it('uses QPP, Quebec EI and QPIP in Quebec', () => {
    const r = calculateTax(input({ province: 'QC', employmentIncome: 120_000 }));
    expect(r.pensionPlanLabel).toBe('QPP');
    expect(r.pensionPlan).toBe(4_895.3);
    expect(r.ei).toBe(895.7);
    expect(r.qpip).toBe(442.9);
    expect(r.employer.ei).toBe(1_253.98);
    expect(r.employer.qpip).toBe(620.06);
  });

  it('charges no CPP below the basic exemption', () => {
    const r = calculateTax(input({ employmentIncome: 3_000 }));
    expect(r.pensionPlan).toBe(0);
    expect(r.ei).toBe(48.9);
  });

  it('self-employed pay both CPP halves and no EI', () => {
    const r = calculateTax(input({ selfEmploymentIncome: 60_000 }));
    expect(r.pensionPlan).toBe(6_723.5);
    expect(r.ei).toBe(0);
    expect(r.employer.total).toBe(0);
  });

  it('applies the exemption and YMPE once across employment and self-employment', () => {
    const r = calculateTax(input({ employmentIncome: 74_600, selfEmploymentIncome: 20_000 }));
    // Employee tier 1 maxed (4,230.45); SE only pays tier 2 on 74,600-85,000, both halves.
    expect(r.pensionPlan).toBeCloseTo(4_230.45 + 10_400 * 0.08, 2);
  });
});

describe('pay periods', () => {
  it.each([
    ['annual', 52_000, 52_000],
    ['monthly', 5_000, 60_000],
    ['biweekly', 2_000, 52_000],
    ['weekly', 1_000, 52_000],
    ['daily', 200, 52_000],
    ['hourly', 25, 52_000],
  ] as const)('%s %i annualizes to %i', (payPeriod, amount, annual) => {
    const r = calculateTax(input({ employmentIncome: amount, payPeriod }));
    expect(r.annualEmploymentIncome).toBe(annual);
  });

  it('hourly uses the entered hours per week', () => {
    const r = calculateTax(input({ employmentIncome: 20, payPeriod: 'hourly', hoursPerWeek: 37.5 }));
    expect(r.annualEmploymentIncome).toBe(39_000);
    expect(periodsPerYear('hourly', 37.5)).toBe(1_950);
  });

  it('falls back to 40 hours when hours per week is missing', () => {
    expect(periodsPerYear('hourly', 0)).toBe(2_080);
  });
});

describe('provincial specifics', () => {
  it('Ontario tax reduction wipes out most tax at low income', () => {
    // Basic ON tax 354.06; reduction = 600 - 354.06 = 245.94; no health premium at 20,000.
    const r = calculateTax(input({ otherIncome: 20_000 }));
    expect(r.ontarioHealthPremium).toBe(0);
    expect(r.provincialTax).toBeCloseTo(108.11, 2);
  });

  it('Ontario Health Premium caps at $900', () => {
    expect(calculateTax(input({ otherIncome: 30_000 })).ontarioHealthPremium).toBe(300);
    expect(calculateTax(input({ otherIncome: 60_000 })).ontarioHealthPremium).toBe(600);
    expect(calculateTax(input({ otherIncome: 500_000 })).ontarioHealthPremium).toBe(900);
  });

  it('BC tax reduction phases out above $25,570', () => {
    // (30,000 - 13,216) x 5.6% = 939.90; reduction 690 - 4,430 x 3.56% = 532.29.
    const r = calculateTax(input({ province: 'BC', otherIncome: 30_000 }));
    expect(r.provincialTax).toBeCloseTo(407.61, 2);
  });

  it('federal basic personal amount bottoms out above $258,482', () => {
    const r = calculateTax(input({ province: 'AB', otherIncome: 300_000 }));
    expect(r.federalTax).toBeCloseTo(70_899.99, 1);
  });
});

describe('income types and the return', () => {
  it('returns zeros for no income', () => {
    const r = calculateTax(input());
    expect(r.totalTax).toBe(0);
    expect(r.afterTaxIncome).toBe(0);
    expect(r.averageTaxRate).toBe(0);
    expect(r.balance).toBe(0);
  });

  it('includes half of capital gains and grosses up dividends', () => {
    const r = calculateTax(
      input({ capitalGains: 10_000, eligibleDividends: 1_000, nonEligibleDividends: 1_000 })
    );
    expect(r.totalIncome).toBe(12_000);
    expect(r.taxableIncome).toBe(5_000 + 1_380 + 1_150);
  });

  it('RRSP/FHSA contributions reduce tax by roughly the marginal rate', () => {
    const without = calculateTax(input({ employmentIncome: 80_000 }));
    const withRrsp = calculateTax(input({ employmentIncome: 80_000, rrspFhsaContributions: 5_000 }));
    const saved = without.incomeTax - withRrsp.incomeTax;
    expect(saved).toBeGreaterThan(5_000 * 0.25);
    expect(saved).toBeLessThan(5_000 * without.marginalTaxRate + 1);
    // Contributions are savings, not tax: after-tax income only moves by the tax saved.
    expect(withRrsp.afterTaxIncome - without.afterTaxIncome).toBeCloseTo(saved, 1);
  });

  it('reports a refund when more tax was paid than owed', () => {
    const owed = calculateTax(input({ employmentIncome: 60_000 }));
    const r = calculateTax(input({ employmentIncome: 60_000, incomeTaxesPaid: owed.incomeTax + 500 }));
    expect(r.balance).toBeCloseTo(500, 1);
  });

  it('paying exactly the income tax shows a zero balance, not -0', () => {
    const owed = calculateTax(input({ employmentIncome: 80_000 }));
    const r = calculateTax(input({ employmentIncome: 80_000, incomeTaxesPaid: owed.incomeTax }));
    expect(Object.is(r.balance, 0)).toBe(true);
    // Copying "Total tax and contributions" instead over-states what was paid by CPP + EI.
    const total = calculateTax(input({ employmentIncome: 80_000, incomeTaxesPaid: owed.totalTax }));
    expect(total.balance).toBeCloseTo(owed.pensionPlan + owed.ei, 2);
  });

  it('reports the income tax an RRSP/FHSA contribution saves', () => {
    expect(calculateTax(input({ employmentIncome: 80_000 })).rrspFhsaTaxSaving).toBe(0);
    const without = calculateTax(input({ employmentIncome: 80_000 }));
    const r = calculateTax(input({ employmentIncome: 80_000, rrspFhsaContributions: 10_000 }));
    expect(r.rrspFhsaTaxSaving).toBeCloseTo(without.incomeTax - r.incomeTax, 2);
    expect(r.rrspFhsaTaxSaving).toBeGreaterThan(0);
    // ...and it becomes refund once the original withholding is entered.
    const paid = calculateTax(
      input({ employmentIncome: 80_000, rrspFhsaContributions: 10_000, incomeTaxesPaid: without.incomeTax })
    );
    expect(paid.balance).toBeCloseTo(r.rrspFhsaTaxSaving, 2);
  });

  it('self-employed owe their CPP on the return', () => {
    const r = calculateTax(input({ selfEmploymentIncome: 60_000 }));
    expect(r.balance).toBeCloseTo(-(r.incomeTax + r.pensionPlan), 1);
  });

  it('employee CPP/EI are not counted as owing (withheld at source)', () => {
    const r = calculateTax(input({ employmentIncome: 60_000 }));
    expect(r.balance).toBeCloseTo(-r.incomeTax, 1);
  });

  it('ignores negative and non-finite amounts', () => {
    const r = calculateTax(input({ employmentIncome: -5_000, otherIncome: Number.NaN }));
    expect(r.totalIncome).toBe(0);
  });

  it('real tax rate includes the employer share', () => {
    const r = calculateTax(input({ employmentIncome: 52_000 }));
    expect(r.employer.realTaxRate).toBeGreaterThan(r.totalDeductionRate);
    expect(r.afterTaxIncome).toBeCloseTo(52_000 - r.totalTax, 2);
  });
});
