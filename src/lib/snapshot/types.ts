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

export interface PersonMoney {
  grossAnnual: number;
  net: number;
  netFrequency: Frequency;
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
}

export interface Goal {
  amount: number;
  /** "YYYY-MM" or "" */
  targetMonth: string;
}

export interface Household {
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
  /** savings ÷ total net income; null without income. */
  savingsRate: number | null;
  debts: DebtResult[];
  roomWarnings: RoomWarning[];
  insurance: InsuranceGap[];
}
