import { z } from 'zod';
import { PROVINCE_NAMES, type ProvinceCode } from '@/lib/tax/rates-2026';
import {
  DEBT_KINDS,
  FREQUENCIES,
  type DebtKind,
  type Frequency,
  type Household,
  type PersonMoney,
} from './types';

/*
 * The snapshot's editable state: text fields exactly as typed (so "1,200."
 * mid-typing isn't clobbered), converted to numbers by `toHousehold`.
 *
 * Unlike the other Tools, this form holds names and dates of birth, so it
 * is NEVER put in the URL — browser history and request logs would keep
 * them. It lives only in the tab's sessionStorage (lib/tools/session-draft,
 * wiped at /login) as JSON, read back through the Zod schema below so a
 * stale or tampered draft falls back to defaults instead of crashing.
 */

export const FORM_VERSION = 1;

export interface PersonForm {
  name: string;
  /** "YYYY-MM-DD" */
  dob: string;
  grossAnnual: string;
  net: string;
  netFrequency: Frequency;
  other: string;
  otherFrequency: Frequency;
  rrspBalance: string;
  rrspRoom: string;
  rrspMonthly: string;
  tfsaBalance: string;
  tfsaRoom: string;
  tfsaMonthly: string;
  fhsaBalance: string;
  fhsaRoom: string;
  fhsaMonthly: string;
  nonRegBalance: string;
  nonRegMonthly: string;
  cash: string;
  groupLife: string;
  personalLife: string;
}

export interface ChildForm {
  id: string;
  name: string;
  dob: string;
  respBalance: string;
  respMonthly: string;
}

export interface DebtForm {
  id: string;
  kind: DebtKind;
  label: string;
  balance: string;
  ratePct: string;
  termYears: string;
  monthlyPayment: string;
}

export interface ExpenseForm {
  id: string;
  label: string;
  amount: string;
  frequency: Frequency;
  essential: boolean;
}

export interface GoalForm {
  id: string;
  text: string;
  amount: string;
  /** "YYYY-MM" */
  targetMonth: string;
}

export interface CustomRecommendation {
  id: string;
  text: string;
}

export const NOTE_MAX = 500;
export const ADVISOR_NOTES_MAX = 2000;

export interface SnapshotForm {
  v: typeof FORM_VERSION;
  province: ProvinceCode;
  client: PersonForm;
  hasSpouse: boolean;
  /** Kept while hidden, so toggling the spouse off and on loses nothing. */
  spouse: PersonForm;
  children: ChildForm[];
  ccbMonthly: string;
  homeValue: string;
  taxRefund: string;
  taxRefundYear: 'this' | 'last';
  debts: DebtForm[];
  expenses: ExpenseForm[];
  goals: GoalForm[];
  incomeReplacementYears: string;
  educationPerChild: string;
  /** Agent's note per automatic recommendation, keyed by its stable id (calculate.ts `Suggestion.id`). */
  recommendationNotes: Record<string, string>;
  customRecommendations: CustomRecommendation[];
  advisorNotes: string;
}

/** Where the open snapshot came from: version 0 = never downloaded or opened from a file. */
export interface SnapshotMeta {
  version: number;
  /** ISO timestamp of the last download/open; "" when version is 0. */
  savedAt: string;
  /** hashForm() of the form as last downloaded/opened; "" when version is 0. */
  savedHash: string;
}

export const EMPTY_META: SnapshotMeta = { version: 0, savedAt: '', savedHash: '' };

export function emptyPerson(): PersonForm {
  return {
    name: '',
    dob: '',
    grossAnnual: '',
    net: '',
    netFrequency: 'monthly',
    other: '',
    otherFrequency: 'monthly',
    rrspBalance: '',
    rrspRoom: '',
    rrspMonthly: '',
    tfsaBalance: '',
    tfsaRoom: '',
    tfsaMonthly: '',
    fhsaBalance: '',
    fhsaRoom: '',
    fhsaMonthly: '',
    nonRegBalance: '',
    nonRegMonthly: '',
    cash: '',
    groupLife: '',
    personalLife: '',
  };
}

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function newChild(): ChildForm {
  return { id: newId('k'), name: '', dob: '', respBalance: '', respMonthly: '' };
}

export function newDebt(kind: DebtKind = 'other'): DebtForm {
  return { id: newId('d'), kind, label: '', balance: '', ratePct: '', termYears: '', monthlyPayment: '' };
}

export function newExpense(): ExpenseForm {
  return { id: newId('e'), label: '', amount: '', frequency: 'monthly', essential: true };
}

/** The intake template's own lines, plus the common ones it was missing. */
const DEFAULT_EXPENSES: [string, boolean][] = [
  ['Rent', true],
  ['Utilities', true],
  ['Car insurance', true],
  ['Phone / internet', true],
  ['Groceries', true],
  ['Gas / transit', true],
  ['Property tax / condo fees', true],
  ['Childcare', true],
  ['India commitments', true],
  ['Subscriptions', false],
  ['Miscellaneous', false],
];

export function defaultForm(): SnapshotForm {
  return {
    v: FORM_VERSION,
    province: 'ON',
    client: emptyPerson(),
    hasSpouse: false,
    spouse: emptyPerson(),
    children: [],
    ccbMonthly: '',
    homeValue: '',
    taxRefund: '',
    taxRefundYear: 'last',
    debts: DEBT_KINDS.map((kind) => ({ ...newDebt(kind), id: `d-${kind}` })),
    expenses: DEFAULT_EXPENSES.map(([label, essential], i) => ({
      id: `e-${i}`,
      label,
      amount: '',
      frequency: 'monthly',
      essential,
    })),
    goals: [1, 2, 3].map((n) => ({ id: `g-${n}`, text: '', amount: '', targetMonth: '' })),
    incomeReplacementYears: '10',
    educationPerChild: '',
    recommendationNotes: {},
    customRecommendations: [],
    advisorNotes: '',
  };
}

/* ---------- reading a stored draft ---------- */

const MAX_TEXT = 200;
const MAX_ROWS = 40;
const text = z.string().max(MAX_TEXT).catch('');
const freq = z.enum(FREQUENCIES).catch('monthly');
const isoDate = z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/).catch('');
const isoMonth = z.string().regex(/^(\d{4}-\d{2})?$/).catch('');
const id = z.string().min(1).max(40);
/** Long text is cut, not wiped: losing a whole note to one extra character would be worse. */
const note = (max: number) =>
  z
    .string()
    .catch('')
    .transform((v) => v.slice(0, max));
const PROVINCE_CODES = Object.keys(PROVINCE_NAMES) as [ProvinceCode, ...ProvinceCode[]];

const personSchema = z
  .object({
    name: text,
    dob: isoDate,
    grossAnnual: text,
    net: text,
    netFrequency: freq,
    other: text,
    otherFrequency: freq,
    rrspBalance: text,
    rrspRoom: text,
    rrspMonthly: text,
    tfsaBalance: text,
    tfsaRoom: text,
    tfsaMonthly: text,
    fhsaBalance: text,
    fhsaRoom: text,
    fhsaMonthly: text,
    nonRegBalance: text,
    nonRegMonthly: text,
    cash: text,
    groupLife: text,
    personalLife: text,
  })
  .catch(emptyPerson);

function rows<T extends z.ZodTypeAny>(item: T, fallback: () => z.infer<T>[]) {
  return z.array(item).max(MAX_ROWS).catch(fallback);
}

const schema = z.object({
  v: z.literal(FORM_VERSION),
  province: z.enum(PROVINCE_CODES).catch('ON'),
  client: personSchema,
  hasSpouse: z.boolean().catch(false),
  spouse: personSchema,
  children: rows(
    z.object({ id, name: text, dob: isoDate, respBalance: text, respMonthly: text }),
    () => []
  ),
  ccbMonthly: text,
  homeValue: text,
  taxRefund: text,
  taxRefundYear: z.enum(['this', 'last']).catch('last'),
  debts: rows(
    z.object({
      id,
      kind: z.enum(DEBT_KINDS).catch('other'),
      label: text,
      balance: text,
      ratePct: text,
      termYears: text,
      monthlyPayment: text,
    }),
    () => defaultForm().debts
  ),
  expenses: rows(
    z.object({ id, label: text, amount: text, frequency: freq, essential: z.boolean().catch(true) }),
    () => defaultForm().expenses
  ),
  goals: rows(
    z.object({ id, text: text, amount: text, targetMonth: isoMonth }),
    () => defaultForm().goals
  ),
  incomeReplacementYears: text,
  educationPerChild: text,
  // Added in P43b; absent from older drafts and files, which load them empty.
  recommendationNotes: z
    .record(z.string().max(80), note(NOTE_MAX))
    .refine((r) => Object.keys(r).length <= 100)
    .catch({}),
  customRecommendations: rows(z.object({ id, text: note(NOTE_MAX) }), () => []),
  advisorNotes: note(ADVISOR_NOTES_MAX),
});

/** Any parsed value -> form, or null when it isn't a v1 snapshot form at all. */
export function parseFormValue(value: unknown): SnapshotForm | null {
  const result = schema.safeParse(value);
  return result.success ? result.data : null;
}

/** JSON text -> form; anything unreadable gives the defaults. */
export function parseForm(json: string | null): SnapshotForm {
  if (!json) return defaultForm();
  try {
    return parseFormValue(JSON.parse(json)) ?? defaultForm();
  } catch {
    return defaultForm();
  }
}

/* ---------- the tab's session draft: form + snapshot meta ---------- */

const metaSchema = z
  .object({
    version: z.number().int().min(0).max(100_000),
    savedAt: z.string().max(40),
    savedHash: z.string().max(40),
  })
  .catch(EMPTY_META);

/** "" for an untouched, never-saved form, so the draft is removed. */
export function serializeDraft(form: SnapshotForm, meta: SnapshotMeta): string {
  if (meta.version === 0 && !serializeForm(form)) return '';
  return JSON.stringify({ form, meta });
}

/**
 * Reads `{ form, meta }`, and also the P43 draft, which stored the form on
 * its own — a draft from before this change still restores.
 */
export function parseDraft(json: string | null): { form: SnapshotForm; meta: SnapshotMeta } {
  const fallback = { form: defaultForm(), meta: EMPTY_META };
  if (!json) return fallback;
  try {
    const raw: unknown = JSON.parse(json);
    if (raw && typeof raw === 'object' && 'form' in raw) {
      const env = raw as { form: unknown; meta?: unknown };
      const form = parseFormValue(env.form);
      return form ? { form, meta: metaSchema.parse(env.meta) } : fallback;
    }
    const legacy = parseFormValue(raw);
    return legacy ? { form: legacy, meta: EMPTY_META } : fallback;
  } catch {
    return fallback;
  }
}

/** JSON for the session draft; "" for an untouched form so the draft is removed. */
export function serializeForm(form: SnapshotForm): string {
  const json = JSON.stringify(form);
  return json === JSON.stringify(defaultForm()) ? '' : json;
}

/* ---------- text -> numbers ---------- */

/** "$1,200.50" -> 1200.5; blank, negative or garbage -> 0. */
export function parseAmount(value: string): number {
  const n = Number(value.replace(/[$,%\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function personMoney(p: PersonForm): PersonMoney {
  const a = parseAmount;
  return {
    grossAnnual: a(p.grossAnnual),
    net: a(p.net),
    netFrequency: p.netFrequency,
    other: a(p.other),
    otherFrequency: p.otherFrequency,
    rrsp: { balance: a(p.rrspBalance), room: a(p.rrspRoom), monthly: a(p.rrspMonthly) },
    tfsa: { balance: a(p.tfsaBalance), room: a(p.tfsaRoom), monthly: a(p.tfsaMonthly) },
    fhsa: { balance: a(p.fhsaBalance), room: a(p.fhsaRoom), monthly: a(p.fhsaMonthly) },
    nonRegBalance: a(p.nonRegBalance),
    nonRegMonthly: a(p.nonRegMonthly),
    cash: a(p.cash),
    groupLife: a(p.groupLife),
    personalLife: a(p.personalLife),
  };
}

export function toHousehold(form: SnapshotForm): Household {
  const a = parseAmount;
  return {
    client: personMoney(form.client),
    spouse: form.hasSpouse ? personMoney(form.spouse) : null,
    children: form.children.map((c) => ({
      respBalance: a(c.respBalance),
      respMonthly: a(c.respMonthly),
    })),
    ccbMonthly: a(form.ccbMonthly),
    homeValue: a(form.homeValue),
    debts: form.debts.map((d) => ({
      kind: d.kind,
      balance: a(d.balance),
      ratePct: Math.min(a(d.ratePct), 100),
      termYears: Math.min(a(d.termYears), 50),
      monthlyPayment: a(d.monthlyPayment),
    })),
    expenses: form.expenses.map((e) => ({
      amount: a(e.amount),
      frequency: e.frequency,
      essential: e.essential,
    })),
    goals: form.goals.map((g) => ({ amount: a(g.amount), targetMonth: g.targetMonth })),
    incomeReplacementYears: Math.min(a(form.incomeReplacementYears), 40),
    educationPerChild: a(form.educationPerChild),
  };
}
