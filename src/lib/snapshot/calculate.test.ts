import { describe, expect, it } from 'vitest';
import {
  ageOn,
  estimateDeposit,
  payrollTotals,
  reconcileDeposit,
  amortizedPayment,
  analyzeDebt,
  estimatePayment,
  estimateTax,
  goalMonthly,
  monthlyRate,
  monthsUntil,
  payoff,
  round2,
  suggestions,
  summarize,
  toMonthly,
} from './calculate';
import { defaultForm, toHousehold } from './form';
import type { Debt, Household, PersonMoney } from './types';

const NOV_2026 = new Date(2026, 10, 1); // 1 Nov 2026: 2 months left in the year

function person(over: Partial<PersonMoney> = {}): PersonMoney {
  return {
    grossAnnual: 0,
    // Tests that set `net` mean a typed figure; auto mode is tested explicitly.
    netMode: 'manual',
    net: 0,
    netFrequency: 'monthly',
    payFrequency: 'biweekly',
    payroll: [],
    other: 0,
    otherFrequency: 'monthly',
    rrsp: { balance: 0, room: 0, monthly: 0 },
    tfsa: { balance: 0, room: 0, monthly: 0 },
    fhsa: { balance: 0, room: 0, monthly: 0 },
    nonRegBalance: 0,
    nonRegMonthly: 0,
    cash: 0,
    groupLife: 0,
    personalLife: 0,
    ...over,
  };
}

function household(over: Partial<Household> = {}): Household {
  return {
    province: 'ON',
    client: person(),
    spouse: null,
    children: [],
    ccbMonthly: 0,
    homeValue: 0,
    debts: [],
    expenses: [],
    goals: [],
    incomeReplacementYears: 10,
    educationPerChild: 0,
    ...over,
  };
}

const debt = (over: Partial<Debt>): Debt => ({
  kind: 'other',
  balance: 0,
  ratePct: 0,
  termYears: 0,
  monthlyPayment: 0,
  ...over,
});

/** The intake template filled in for a couple with one child. */
function templateExample(): Household {
  return household({
    client: person({ net: 4000, rrsp: { balance: 20_000, room: 10_000, monthly: 500 }, cash: 10_000 }),
    spouse: person({
      net: 2000,
      netFrequency: 'biweekly',
      tfsa: { balance: 5_000, room: 0, monthly: 200 },
    }),
    children: [{ respBalance: 3_000, respMonthly: 100 }],
    ccbMonthly: 300,
    homeValue: 0,
    debts: [
      debt({ kind: 'card', balance: 5_000, ratePct: 19.99 }),
      debt({ kind: 'car', balance: 20_000, ratePct: 6, termYears: 5, monthlyPayment: 400 }),
    ],
    expenses: [
      { amount: 2000, frequency: 'monthly', essential: true, protection: false },
      { amount: 250, frequency: 'weekly', essential: true, protection: false },
      { amount: 1200, frequency: 'annual', essential: false, protection: false },
    ],
  });
}

describe('toMonthly', () => {
  it('converts every frequency to a monthly amount', () => {
    expect(toMonthly(1200, 'monthly')).toBe(1200);
    expect(toMonthly(1200, 'annual')).toBe(100);
    expect(toMonthly(1000, 'semimonthly')).toBe(2000);
    expect(round2(toMonthly(2000, 'biweekly'))).toBe(4333.33); // ×26/12, not ×2
    expect(round2(toMonthly(250, 'weekly'))).toBe(1083.33);
  });

  it('treats negative or non-finite amounts as zero', () => {
    expect(toMonthly(-50, 'monthly')).toBe(0);
    expect(toMonthly(Number.NaN, 'weekly')).toBe(0);
  });
});

describe('summarize — the template totals', () => {
  const s = summarize(templateExample(), NOV_2026);

  it('adds both incomes and the CCB into Total Net Income', () => {
    expect(s.totalNetIncome).toBe(8633.33);
  });

  it('takes savings (incl. RESP) off to get Net Income after savings', () => {
    expect(s.savingsMonthly).toBe(800);
    expect(s.netAfterSavings).toBe(7833.33);
  });

  it('counts debt payments in Total Expenses (estimating the card minimum)', () => {
    expect(s.debts[0]).toMatchObject({ payment: 150, estimated: true, highInterest: true });
    expect(s.debts[1]).toMatchObject({ payment: 400, estimated: false, highInterest: false });
    expect(s.debtPayments).toBe(550);
    expect(s.expenseLines).toBe(3183.33);
    expect(s.totalExpenses).toBe(3733.33);
  });

  it('gives the Balance Amount', () => {
    expect(s.balance).toBe(4100);
  });

  it('measures the emergency fund against essential spending only', () => {
    expect(s.essentialMonthly).toBe(3633.33);
    expect(s.emergencyMonths).toBeCloseTo(10_000 / 3633.333, 4);
  });

  it('computes net worth', () => {
    expect(s.assets).toBe(38_000);
    expect(s.liabilities).toBe(25_000);
    expect(s.netWorth).toBe(13_000);
  });
});

describe('summarize — edge cases', () => {
  it('an empty form is all zeros, never -0', () => {
    const s = summarize(toHousehold(defaultForm()), NOV_2026);
    expect(Object.is(s.balance, 0)).toBe(true);
    expect(s.totalExpenses).toBe(0);
    expect(s.emergencyMonths).toBeNull();
    expect(s.savingsRate).toBeNull();
    expect(s.roomWarnings).toEqual([]);
  });

  it('a balance of exactly zero is +0', () => {
    const s = summarize(
      household({
        client: person({ net: 1000 }),
        expenses: [{ amount: 1000, frequency: 'monthly', essential: true, protection: false }],
      })
    );
    expect(Object.is(s.balance, 0)).toBe(true);
  });

  it('a shortfall is negative', () => {
    const s = summarize(
      household({
        client: person({ net: 1000 }),
        expenses: [{ amount: 1500, frequency: 'monthly', essential: true, protection: false }],
      })
    );
    expect(s.balance).toBe(-500);
  });

  it('ignores the spouse when there is none', () => {
    const s = summarize(household({ client: person({ net: 3000 }) }));
    expect(s.totalNetIncome).toBe(3000);
    expect(s.insurance.map((g) => g.person)).toEqual(['client']);
  });
});

describe('contribution room', () => {
  it('warns when the rest of the year would exceed the room', () => {
    const h = household({ client: person({ tfsa: { balance: 0, room: 500, monthly: 400 } }) });
    expect(summarize(h, NOV_2026).roomWarnings).toEqual([
      { person: 'client', account: 'TFSA', projected: 800, room: 500, over: 300 },
    ]);
  });

  it('stays quiet within the room or when room was not entered', () => {
    const h = household({
      client: person({
        rrsp: { balance: 0, room: 1000, monthly: 500 },
        tfsa: { balance: 0, room: 0, monthly: 9000 },
      }),
    });
    expect(summarize(h, NOV_2026).roomWarnings).toEqual([]);
  });
});

describe('debts', () => {
  it('amortizes a car loan monthly', () => {
    expect(round2(amortizedPayment(20_000, 0.06 / 12, 60))).toBe(386.66);
    expect(round2(estimatePayment(debt({ kind: 'car', balance: 20_000, ratePct: 6, termYears: 5 })))).toBe(
      386.66
    );
  });

  it('compounds a mortgage semi-annually', () => {
    expect(monthlyRate({ kind: 'mortgage', ratePct: 5 })).toBeCloseTo(0.0041239, 6);
    const p = estimatePayment(debt({ kind: 'mortgage', balance: 500_000, ratePct: 5, termYears: 25 }));
    expect(p).toBeCloseTo(2908.02, 1);
  });

  it('assumes interest-only on a line of credit, which never pays off', () => {
    const r = analyzeDebt(debt({ kind: 'loc', balance: 12_000, ratePct: 9 }));
    expect(r.payment).toBe(90);
    expect(r.payoffMonths).toBeNull();
  });

  it('a card minimum is 3%, at least $10, at most the balance', () => {
    expect(estimatePayment(debt({ kind: 'card', balance: 1000 }))).toBe(30);
    expect(estimatePayment(debt({ kind: 'card', balance: 200 }))).toBe(10);
    expect(estimatePayment(debt({ kind: 'card', balance: 6 }))).toBe(6);
  });

  it('payoff: months and interest, or null when the payment only covers interest', () => {
    expect(payoff(1200, 0, 100)).toEqual({ months: 12, totalInterest: 0 });
    const car = payoff(20_000, 0.005, 386.66);
    expect(car?.months).toBe(60);
    expect(car?.totalInterest).toBeCloseTo(3199.6, 0);
    expect(payoff(10_000, 0.01, 100)).toBeNull();
    expect(payoff(10_000, 0.01, 0)).toBeNull();
    expect(payoff(0, 0.01, 0)).toEqual({ months: 0, totalInterest: 0 });
  });

  it('an empty debt row is not estimated and adds nothing', () => {
    expect(analyzeDebt(debt({ kind: 'card' }))).toMatchObject({ payment: 0, estimated: false, payoffMonths: 0 });
  });
});

describe('insurance gap', () => {
  it('needs debts + income replacement + education, less cover and accessible savings', () => {
    const h = household({
      client: person({ net: 5000, groupLife: 100_000, tfsa: { balance: 20_000, room: 0, monthly: 0 }, rrsp: { balance: 50_000, room: 0, monthly: 0 } }),
      children: [{ respBalance: 0, respMonthly: 0 }],
      debts: [debt({ kind: 'mortgage', balance: 400_000, ratePct: 5, termYears: 25 })],
      incomeReplacementYears: 10,
      educationPerChild: 50_000,
    });
    const [g] = summarize(h).insurance;
    // 400k + 10 × 12 × 5k + 50k = 1,050,000; have 100k + 20k TFSA (RRSP excluded).
    expect(g).toEqual({ person: 'client', need: 1_050_000, have: 120_000, gap: 930_000 });
  });

  it('never reports a negative gap', () => {
    const h = household({ client: person({ personalLife: 1_000_000 }) });
    expect(summarize(h).insurance[0].gap).toBe(0);
  });
});

describe('goals, ages, tax', () => {
  it('monthsUntil counts from this month and rejects the past', () => {
    expect(monthsUntil('2027-11', NOV_2026)).toBe(12);
    expect(monthsUntil('2026-11', NOV_2026)).toBeNull();
    expect(monthsUntil('', NOV_2026)).toBeNull();
  });

  it('goalMonthly spreads the amount evenly', () => {
    expect(goalMonthly(12_000, '2027-11', NOV_2026)).toEqual({ months: 12, monthly: 1000 });
    expect(goalMonthly(0, '2027-11', NOV_2026)).toBeNull();
  });

  it('ageOn handles birthdays not yet reached this year', () => {
    expect(ageOn('1990-11-01', NOV_2026)).toBe(36);
    expect(ageOn('1990-11-02', NOV_2026)).toBe(35);
    expect(ageOn('2030-01-01', NOV_2026)).toBeNull();
    expect(ageOn('', NOV_2026)).toBeNull();
  });

  it('estimateTax agrees with the Tax Calculator engine', () => {
    const t = estimateTax(80_000, 'ON', 6_000);
    expect(t).not.toBeNull();
    expect(t!.netMonthly).toBeGreaterThan(4_500);
    expect(t!.netMonthly).toBeLessThan(5_500);
    expect(t!.marginalRate).toBeGreaterThan(0.25);
    expect(t!.rrspFhsaSaving).toBeGreaterThan(1_500);
    expect(estimateTax(0, 'ON')).toBeNull();
  });
});

describe('suggestions', () => {
  const ctx = { names: { client: 'Asha', spouse: '' }, marginalRate: 0.3148, debtLabels: [] };

  it('raises the high-interest card, emergency fund, RESP and RRSP-vs-TFSA', () => {
    const h = templateExample();
    h.client.cash = 1000;
    const tips = suggestions(h, summarize(h, NOV_2026), ctx).map((t) => t.text);
    expect(tips[0]).toMatch(/^Set aside 5% of net income for protection/);
    expect(tips[1]).toMatch(/Credit card \(19\.99%\)/);
    expect(tips.some((t) => t.startsWith('Build an emergency fund'))).toBe(true);
    expect(tips.some((t) => t.startsWith('Asha: estimated life-insurance gap'))).toBe(true);
    expect(tips.some((t) => t.startsWith('RESP:'))).toBe(true);
    expect(tips.at(-1)).toMatch(/RRSP before TFSA/);
  });

  it('leads with a shortfall and skips the surplus tip', () => {
    const h = household({
      client: person({ net: 1000, personalLife: 1e7 }),
      expenses: [{ amount: 1500, frequency: 'monthly', essential: true, protection: false }],
    });
    h.client.cash = 1e6;
    const tips = suggestions(h, summarize(h), ctx).map((t) => t.text);
    expect(tips).toHaveLength(2);
    expect(tips[0]).toMatch(/^Spending is \$500 a month more/);
    expect(tips[1]).toMatch(/^Set aside 5%/);
  });

  it('suggests the FHSA only when there is unused room and no mortgage', () => {
    const h = household({ client: person({ fhsa: { balance: 0, room: 8000, monthly: 0 }, personalLife: 1e7 }) });
    expect(suggestions(h, summarize(h), ctx).some((t) => t.text.includes('FHSA room'))).toBe(true);
    h.debts = [debt({ kind: 'mortgage', balance: 1 })];
    expect(suggestions(h, summarize(h), ctx).some((t) => t.text.includes('FHSA room'))).toBe(false);
  });

  it('gives each recommendation a stable id that survives changing numbers', () => {
    const ids = (h: Household) =>
      suggestions(h, summarize(h, NOV_2026), { ...ctx, debtIds: ['d-card', 'd-car'] }).map((t) => t.id);
    const h = templateExample();
    h.client.cash = 1000;
    const before = ids(h);
    expect(before).toContain('debt:d-card');
    expect(before).toContain('emergency');
    expect(before).toContain('insurance:client');
    expect(before).toContain('resp');
    expect(before).toContain('registered-choice');
    h.debts[0].balance = 4000; // numbers change, ids don't
    expect(ids(h)).toEqual(before);
    h.debts[0].balance = 0; // card paid off: its recommendation goes away
    expect(ids(h)).not.toContain('debt:d-card');
  });

  it('falls back to the row index when no debt ids are given', () => {
    const h = templateExample();
    expect(suggestions(h, summarize(h, NOV_2026), ctx).map((t) => t.id)).toContain('debt:0');
  });
});

describe('workplace deductions and auto net income (P43c)', () => {
  const gross = 85_000;

  it('auto net income is the calculated deposit; typed net is ignored in auto mode', () => {
    const p = person({ grossAnnual: gross, netMode: 'auto', net: 1 });
    const est = estimateDeposit(p, 'ON')!;
    expect(est.depositMonthly).toBeGreaterThan(5_000);
    expect(est.depositMonthly).toBeLessThan(6_000);
    expect(summarize(household({ client: p })).totalNetIncome).toBe(est.depositMonthly);
  });

  it('manual mode uses exactly what was typed', () => {
    const p = person({ grossAnnual: gross, netMode: 'manual', net: 2000, netFrequency: 'biweekly' });
    expect(summarize(household({ client: p })).totalNetIncome).toBe(4333.33);
  });

  it('a pre-tax group RRSP lowers tax, so the deposit drops by less than the contribution', () => {
    const base = estimateDeposit(person({ grossAnnual: gross }), 'ON')!;
    const rrsp = person({
      grossAnnual: gross,
      payroll: [{ kind: 'group-rrsp', amount: 150, employer: 0 }],
    });
    const est = estimateDeposit(rrsp, 'ON')!;
    const contributionMonthly = (150 * 26) / 12; // 325
    const drop = base.depositMonthly - est.depositMonthly;
    expect(drop).toBeGreaterThan(0);
    expect(drop).toBeLessThan(contributionMonthly);
    expect(est.payrollTaxSaving).toBeCloseTo((contributionMonthly - drop) * 12, 0);
  });

  it('an after-tax premium comes off the deposit one for one', () => {
    const base = estimateDeposit(person({ grossAnnual: gross }), 'ON')!;
    const est = estimateDeposit(
      person({ grossAnnual: gross, payroll: [{ kind: 'benefits', amount: 40, employer: 99 }] }),
      'ON'
    )!;
    expect(round2(base.depositMonthly - est.depositMonthly)).toBe(round2((40 * 26) / 12));
    expect(est.payrollTaxSaving).toBe(0);
  });

  it('personal RRSP from the bank earns a refund; payroll RRSP does not add to it', () => {
    const p = person({ grossAnnual: gross, rrsp: { balance: 0, room: 0, monthly: 500 } });
    expect(estimateDeposit(p, 'ON')!.personalRefund).toBeGreaterThan(1_500);
    const payrollOnly = person({
      grossAnnual: gross,
      payroll: [{ kind: 'group-rrsp', amount: 230, employer: 0 }],
    });
    expect(estimateDeposit(payrollOnly, 'ON')!.personalRefund).toBe(0);
  });

  it('payroll savings are counted once: shown as saved through work, never subtracted from the deposit again', () => {
    const p = person({
      grossAnnual: gross,
      netMode: 'auto',
      payroll: [
        { kind: 'group-rrsp', amount: 100, employer: 50 },
        { kind: 'benefits', amount: 40, employer: 0 },
      ],
    });
    const s = summarize(household({ client: p }));
    expect(s.savedThroughWork).toBe(round2((150 * 26) / 12));
    expect(s.savingsMonthly).toBe(0);
    expect(s.netAfterSavings).toBe(s.totalNetIncome);
    expect(payrollTotals(p)).toMatchObject({ preTax: 2600, afterTax: 1040, employeeSavings: 2600, employerMatch: 1300 });
  });

  it('group RRSP and the employer match use RRSP room', () => {
    const p = person({
      grossAnnual: gross,
      rrsp: { balance: 0, room: 500, monthly: 0 },
      payroll: [{ kind: 'group-rrsp', amount: 100, employer: 50 }],
    });
    const [w] = summarize(household({ client: p }), NOV_2026).roomWarnings;
    expect(w).toMatchObject({ account: 'RRSP', projected: 650, room: 500, over: 150 });
  });

  it('reconciles a typed deposit only when the gap is meaningful', () => {
    const est = estimateDeposit(person({ grossAnnual: gross }), 'ON')!.depositMonthly;
    const close = person({ grossAnnual: gross, netMode: 'manual', net: est - 20 });
    expect(reconcileDeposit(close, 'ON')).toBeNull();
    const far = person({ grossAnnual: gross, netMode: 'manual', net: est - 400 });
    expect(reconcileDeposit(far, 'ON')).toEqual({ estimated: est, entered: round2(est - 400), gap: 400 });
    expect(reconcileDeposit({ ...far, netMode: 'auto' }, 'ON')).toBeNull();
    expect(reconcileDeposit({ ...far, grossAnnual: 0 }, 'ON')).toBeNull();
  });
});

describe('5% protection set-aside (P43c)', () => {
  const ctx = { names: { client: 'Asha', spouse: '' }, marginalRate: null, debtLabels: [] };
  const premiums = (amount: number) => ({ amount, frequency: 'monthly' as const, essential: true, protection: true });

  it('is 5% of household net income, shown alongside the balance', () => {
    const h = household({ client: person({ net: 6000 }), ccbMonthly: 400 });
    const s = summarize(h);
    expect(s.protectionTarget).toBe(320);
    expect(s.protectionGap).toBe(320);
    expect(s.balance).toBe(6400);
    expect(s.balanceAfterProtection).toBe(6080);
    const tip = suggestions(h, s, ctx).find((t) => t.id === 'protection')!;
    expect(tip.text).toBe(
      'Set aside 5% of net income for protection: $320/month ($3,840/year), before other expenses.'
    );
  });

  it('credits premiums already paid', () => {
    const h = household({ client: person({ net: 6000 }), expenses: [premiums(200)] });
    const s = summarize(h);
    expect(s.protectionGap).toBe(100);
    expect(suggestions(h, s, ctx).find((t) => t.id === 'protection')!.text).toMatch(
      /Currently paying \$200; about \$100 more a month would reach 5%\.$/
    );
    const enough = household({ client: person({ net: 6000 }), expenses: [premiums(350)] });
    const s2 = summarize(enough);
    expect(s2.protectionGap).toBe(0);
    expect(s2.balanceAfterProtection).toBe(s2.balance);
    expect(suggestions(enough, s2, ctx).find((t) => t.id === 'protection')!.text).toMatch(/which meets it\.$/);
  });

  it('is not shown without income', () => {
    const h = household();
    expect(suggestions(h, summarize(h), ctx).some((t) => t.id === 'protection')).toBe(false);
  });

  it('asks about an employer match on a group RRSP with none entered', () => {
    const h = household({
      client: person({ net: 5000, payroll: [{ kind: 'group-rrsp', amount: 100, employer: 0 }] }),
    });
    expect(suggestions(h, summarize(h), ctx).some((t) => t.id === 'employer-match:client')).toBe(true);
    h.client.payroll[0].employer = 50;
    expect(suggestions(h, summarize(h), ctx).some((t) => t.id === 'employer-match:client')).toBe(false);
  });
});
