import { describe, expect, it } from 'vitest';
import {
  defaultForm,
  EMPTY_META,
  NOTE_MAX,
  parseAmount,
  parseDraft,
  parseForm,
  serializeDraft,
  serializeForm,
  toHousehold,
} from './form';

describe('snapshot form draft', () => {
  it('an untouched form serializes to "" so the draft is removed', () => {
    expect(serializeForm(defaultForm())).toBe('');
  });

  it('round-trips an edited form', () => {
    const form = defaultForm();
    form.client.name = 'Asha';
    form.client.dob = '1990-04-12';
    form.hasSpouse = true;
    form.spouse.net = '2,000';
    form.expenses[0].amount = '1800';
    expect(parseForm(serializeForm(form))).toEqual(form);
  });

  it('falls back to defaults for missing, broken or foreign JSON', () => {
    expect(parseForm(null)).toEqual(defaultForm());
    expect(parseForm('{not json')).toEqual(defaultForm());
    expect(parseForm('{"v":99}')).toEqual(defaultForm());
  });

  it('repairs bad fields instead of discarding the whole draft', () => {
    const form = defaultForm();
    form.client.name = 'Asha';
    const raw = JSON.parse(JSON.stringify(form));
    raw.client.netFrequency = 'fortnightly';
    raw.client.dob = '12/04/1990';
    raw.province = 'XX';
    raw.expenses = 'nope';
    const parsed = parseForm(JSON.stringify(raw));
    expect(parsed.client.name).toBe('Asha');
    expect(parsed.client.netFrequency).toBe('monthly');
    expect(parsed.client.dob).toBe('');
    expect(parsed.province).toBe('ON');
    expect(parsed.expenses).toEqual(defaultForm().expenses);
  });
});

describe('parseAmount', () => {
  it('reads money as typed', () => {
    expect(parseAmount('$1,200.50')).toBe(1200.5);
    expect(parseAmount(' 7.5% ')).toBe(7.5);
  });

  it('blank, negative and garbage are 0', () => {
    expect(parseAmount('')).toBe(0);
    expect(parseAmount('-5')).toBe(0);
    expect(parseAmount('abc')).toBe(0);
  });
});

describe('toHousehold', () => {
  it('drops the spouse when hidden but keeps their typed values in the form', () => {
    const form = defaultForm();
    form.spouse.net = '3000';
    expect(toHousehold(form).spouse).toBeNull();
    form.hasSpouse = true;
    expect(toHousehold(form).spouse?.net).toBe(3000);
  });

  it('caps rates, terms and replacement years', () => {
    const form = defaultForm();
    form.debts[0].ratePct = '500';
    form.debts[0].termYears = '99';
    form.incomeReplacementYears = '80';
    const h = toHousehold(form);
    expect(h.debts[0].ratePct).toBe(100);
    expect(h.debts[0].termYears).toBe(50);
    expect(h.incomeReplacementYears).toBe(40);
  });

  it('defaults include the template debts and expense lines', () => {
    const form = defaultForm();
    expect(form.debts.map((d) => d.kind)).toEqual(['card', 'loc', 'car', 'mortgage', 'other']);
    expect(form.expenses.map((e) => e.label)).toContain('India commitments');
    expect(form.goals).toHaveLength(3);
  });
});

describe('session draft envelope (P43b)', () => {
  const meta = { version: 2, savedAt: '2026-11-01T14:05:00.000Z', savedHash: 'abcd1234' };

  it('round-trips form + meta', () => {
    const form = defaultForm();
    form.client.name = 'Asha';
    form.recommendationNotes = { resp: 'Starting in January' };
    expect(parseDraft(serializeDraft(form, meta))).toEqual({ form, meta });
  });

  it('removes the draft for an untouched, never-saved form, but keeps a saved one', () => {
    expect(serializeDraft(defaultForm(), EMPTY_META)).toBe('');
    expect(serializeDraft(defaultForm(), meta)).not.toBe('');
  });

  it('still restores a P43 draft (form only, no envelope)', () => {
    const form = defaultForm();
    form.client.name = 'Asha';
    const legacy = JSON.stringify(form);
    const draft = parseDraft(legacy);
    expect(draft.meta).toEqual(EMPTY_META);
    expect(draft.form.client.name).toBe('Asha');
    expect(draft.form.recommendationNotes).toEqual({});
    expect(draft.form.advisorNotes).toBe('');
  });

  it('bad meta falls back to never-saved; garbage falls back to defaults', () => {
    const form = defaultForm();
    form.client.name = 'Asha';
    const d = parseDraft(JSON.stringify({ form, meta: { version: 'x' } }));
    expect(d.meta).toEqual(EMPTY_META);
    expect(d.form.client.name).toBe('Asha');
    expect(parseDraft('{oops')).toEqual({ form: defaultForm(), meta: EMPTY_META });
  });

  it('cuts an over-long note instead of wiping it', () => {
    const form = defaultForm();
    const raw = JSON.parse(JSON.stringify(form));
    raw.recommendationNotes = { emergency: 'x'.repeat(NOTE_MAX + 50) };
    expect(parseForm(JSON.stringify(raw)).recommendationNotes.emergency).toHaveLength(NOTE_MAX);
  });
});
