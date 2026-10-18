// Unit coverage for commitImport's batched rewrite (fixes the "still
// failing on large batches" report -- the old version did up to 4 sequential
// DB round-trips per row, fully serial). The database is the in-memory fake
// in src/test/fake-supabase.ts.
import { describe, expect, it } from 'vitest';
import type { ParsedRow } from './parse-workbook';
import { commitImport } from './commit-import';
import { fakeClient as makeFake, type FakeSupabase } from '@/test/fake-supabase';

function fakeClient() {
  return makeFake().client;
}

const AGENT_ID = 'agent-1';
const ORG_ID = 'org-1';

function callLogRow(rowNumber: number, contactName: string): ParsedRow {
  return {
    sheet: 'Call Log',
    rowNumber,
    rowHash: `call-${rowNumber}`,
    errors: [],
    data: {
      contactName,
      callDate: '2026-08-01',
      source: 'referral',
      outcome: 'connected',
      notes: null,
    },
  };
}

function saleRow(rowNumber: number, clientName: string): ParsedRow {
  return {
    sheet: 'Sales Log',
    rowNumber,
    rowHash: `sale-${rowNumber}`,
    errors: [],
    data: {
      clientName,
      saleDate: '2026-08-01',
      productType: null,
      premiumCents: 10000,
      notes: null,
    },
  };
}

function contactOnlyRow(rowNumber: number, fullName: string, phoneNumber: string | null = null): ParsedRow {
  return {
    sheet: 'Contacts',
    rowNumber,
    rowHash: `contact-${rowNumber}`,
    errors: [],
    data: { fullName },
    phoneNumber,
  };
}

describe('commitImport', () => {
  it('resolves the same new person across multiple sheets to one contact', async () => {
    const supabase = fakeClient();
    const rows = [callLogRow(2, 'John Doe'), saleRow(2, 'John Doe')];

    const result = await commitImport(supabase, AGENT_ID, ORG_ID, rows);

    expect(result.errors).toEqual([]);
    expect(result.imported).toBe(2);
    const contacts = (supabase as unknown as FakeSupabase).tables.contacts;
    expect(contacts).toHaveLength(1);
    const callLogs = (supabase as unknown as FakeSupabase).tables.call_logs;
    const sales = (supabase as unknown as FakeSupabase).tables.sales;
    expect(callLogs[0].contact_id).toBe(contacts[0].id);
    expect(sales[0].contact_id).toBe(contacts[0].id);
  });

  it('creates a brand-new contact with just a name', async () => {
    const supabase = fakeClient();
    const result = await commitImport(supabase, AGENT_ID, ORG_ID, [contactOnlyRow(2, 'Jane Doe')]);

    expect(result.errors).toEqual([]);
    expect(result.imported).toBe(1);
    const contacts = (supabase as unknown as FakeSupabase).tables.contacts;
    expect(contacts[0]).toMatchObject({ full_name: 'Jane Doe', phone_number: null });
  });

  it('saves a Contacts-sheet phone number on a new contact', async () => {
    const supabase = fakeClient();
    const result = await commitImport(supabase, AGENT_ID, ORG_ID, [contactOnlyRow(2, 'Jane Doe', '+14165550123')]);

    expect(result.errors).toEqual([]);
    expect((supabase as unknown as FakeSupabase).tables.contacts[0]).toMatchObject({
      full_name: 'Jane Doe',
      phone_number: '+14165550123',
    });
  });

  it('fills in a missing number on an existing contact but never replaces one', async () => {
    const supabase = fakeClient();
    const contacts = (supabase as unknown as FakeSupabase).tables.contacts;
    contacts.push(
      { id: 'no-number', agent_id: AGENT_ID, org_id: ORG_ID, full_name: 'Jane Doe', phone_number: null },
      { id: 'has-number', agent_id: AGENT_ID, org_id: ORG_ID, full_name: 'John Roe', phone_number: '+447946095800' }
    );

    const result = await commitImport(supabase, AGENT_ID, ORG_ID, [
      contactOnlyRow(2, 'jane doe', '+14165550123'),
      contactOnlyRow(3, 'John Roe', '+16475550199'),
    ]);

    expect(result.errors).toEqual([]);
    expect(result.imported).toBe(2);
    expect(contacts).toHaveLength(2);
    expect(contacts.find((c) => c.id === 'no-number')?.phone_number).toBe('+14165550123');
    expect(contacts.find((c) => c.id === 'has-number')?.phone_number).toBe('+447946095800');
  });

  it('saves a phone number from an activity sheet on the contact it creates', async () => {
    const supabase = fakeClient();
    const rows = [{ ...callLogRow(2, 'John Doe'), phoneNumber: '+16475550199' }, saleRow(3, 'John Doe')];

    const result = await commitImport(supabase, AGENT_ID, ORG_ID, rows);

    expect(result.errors).toEqual([]);
    const contacts = (supabase as unknown as FakeSupabase).tables.contacts;
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({ full_name: 'John Doe', phone_number: '+16475550199' });
  });

  it('drops a phone number that is not E.164 instead of failing the insert', async () => {
    const supabase = fakeClient();
    const result = await commitImport(supabase, AGENT_ID, ORG_ID, [contactOnlyRow(2, 'Jane Doe', '416-555-0123')]);

    expect(result.errors).toEqual([]);
    expect((supabase as unknown as FakeSupabase).tables.contacts[0]).toMatchObject({ phone_number: null });
  });

  it('is idempotent on re-import: skips already-imported rows without duplicating contacts or activity rows', async () => {
    const supabase = fakeClient();
    const rows = [callLogRow(2, 'John Doe'), saleRow(3, 'Mary Smith')];

    const first = await commitImport(supabase, AGENT_ID, ORG_ID, rows);
    expect(first.imported).toBe(2);
    expect(first.skippedDuplicate).toBe(0);

    const second = await commitImport(supabase, AGENT_ID, ORG_ID, rows);
    expect(second.imported).toBe(0);
    expect(second.skippedDuplicate).toBe(2);
    expect(second.errors).toEqual([]);

    expect((supabase as unknown as FakeSupabase).tables.contacts).toHaveLength(2);
    expect((supabase as unknown as FakeSupabase).tables.call_logs).toHaveLength(1);
    expect((supabase as unknown as FakeSupabase).tables.sales).toHaveLength(1);
  });

  it('matches an existing contact by name', async () => {
    const supabase = fakeClient();
    (supabase as unknown as FakeSupabase).tables.contacts.push({
      id: 'existing-1',
      agent_id: AGENT_ID,
      org_id: ORG_ID,
      full_name: 'John Doe',
    });

    const result = await commitImport(supabase, AGENT_ID, ORG_ID, [callLogRow(2, 'John Doe')]);

    expect(result.errors).toEqual([]);
    expect(result.imported).toBe(1);
    const contacts = (supabase as unknown as FakeSupabase).tables.contacts;
    expect(contacts).toHaveLength(1); // matched, not duplicated
    expect((supabase as unknown as FakeSupabase).tables.call_logs[0].contact_id).toBe('existing-1');
  });

  it('reports a row error without losing the rest of a mixed chunk', async () => {
    const supabase = fakeClient();
    const rows: ParsedRow[] = [
      callLogRow(2, 'Good Contact'),
      { sheet: 'Call Log', rowNumber: 3, rowHash: 'bad-1', errors: ['Invalid or missing date.'], data: null },
    ];

    const result = await commitImport(supabase, AGENT_ID, ORG_ID, rows);

    expect(result.imported).toBe(1);
    expect(result.errors).toEqual([{ sheet: 'Call Log', rowNumber: 3, message: 'Invalid or missing date.' }]);
  });
});
