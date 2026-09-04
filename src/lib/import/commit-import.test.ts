// Unit coverage for commitImport's batched rewrite (fixes the "still
// failing on large batches" report -- the old version did up to 4 sequential
// DB round-trips per row, fully serial). No local Supabase needed: a small
// in-memory fake stands in for the query builder subset commit-import.ts
// actually uses, including Postgres's real "one bad row aborts the whole
// multi-row INSERT statement" behavior, so the pre-filter/fallback paths get
// exercised the same way they would against a real database.
import { describe, expect, it } from 'vitest';
import type { ParsedRow } from './parse-workbook';
import { commitImport } from './commit-import';

type Row = Record<string, unknown>;

class FakeQuery implements PromiseLike<{ data: Row[] | null; error: { code: string } | null }> {
  private filters: { kind: 'eq' | 'in'; col: string; val: unknown }[] = [];
  private selectCols: string[] | null = null;
  private op: 'select' | 'insert' | 'update' = 'select';
  private payload: Row[] = [];

  constructor(
    private table: Row[],
    private tableName: string
  ) {}

  select(cols: string) {
    this.selectCols = cols.split(',').map((c) => c.trim());
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push({ kind: 'eq', col, val });
    return this;
  }
  in(col: string, vals: unknown[]) {
    this.filters.push({ kind: 'in', col, val: vals });
    return this;
  }
  insert(rows: Row | Row[]) {
    this.op = 'insert';
    this.payload = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  update(data: Row) {
    this.op = 'update';
    this.payload = [data];
    return this;
  }
  maybeSingle() {
    return this;
  }

  private matches(row: Row): boolean {
    return this.filters.every((f) => (f.kind === 'eq' ? row[f.col] === f.val : (f.val as unknown[]).includes(row[f.col])));
  }

  private project(rows: Row[]): Row[] {
    if (!this.selectCols) return rows;
    return rows.map((r) => Object.fromEntries(this.selectCols!.map((c) => [c, r[c]])));
  }

  private conflicts(row: Row): boolean {
    if (this.tableName === 'contacts') {
      const nameKey = String(row.full_name).toLowerCase();
      if (this.table.some((r) => r.agent_id === row.agent_id && String(r.full_name).toLowerCase() === nameKey)) return true;
      return false;
    }
    if (row.import_row_hash) {
      return this.table.some((r) => r.agent_id === row.agent_id && r.import_row_hash === row.import_row_hash);
    }
    return false;
  }

  async execute(): Promise<{ data: Row[] | null; error: { code: string } | null }> {
    if (this.op === 'select') {
      return { data: this.project(this.table.filter((r) => this.matches(r))), error: null };
    }
    if (this.op === 'update') {
      for (const r of this.table.filter((r) => this.matches(r))) Object.assign(r, this.payload[0]);
      return { data: null, error: null };
    }
    // insert -- Postgres aborts the *entire* multi-row statement if any row
    // in it conflicts, which is exactly the behavior commitActivityRows'
    // pre-filter-then-fallback logic is designed around.
    const seenInBatch = new Set<string>();
    for (const row of this.payload) {
      if (this.conflicts(row)) return { data: null, error: { code: '23505' } };
      if (this.tableName === 'contacts') {
        const key = String(row.full_name).toLowerCase();
        if (seenInBatch.has(key)) return { data: null, error: { code: '23505' } };
        seenInBatch.add(key);
      }
    }
    const inserted = this.payload.map((row, i) => ({
      id: `${this.tableName}-${this.table.length + i + 1}`,
      ...row,
    }));
    this.table.push(...inserted);
    return { data: this.project(inserted), error: null };
  }

  then<TResult1, TResult2 = never>(
    onfulfilled?: ((value: { data: Row[] | null; error: { code: string } | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

class FakeSupabase {
  tables: Record<string, Row[]> = { contacts: [], call_logs: [], appointments: [], sales: [], recruiting_logs: [] };
  from(tableName: string) {
    return new FakeQuery(this.tables[tableName], tableName);
  }
}

function fakeClient() {
  return new FakeSupabase() as unknown as Parameters<typeof commitImport>[0];
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

function contactOnlyRow(rowNumber: number, fullName: string): ParsedRow {
  return {
    sheet: 'Contacts',
    rowNumber,
    rowHash: `contact-${rowNumber}`,
    errors: [],
    data: { fullName },
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
    expect(contacts[0]).toMatchObject({ full_name: 'Jane Doe' });
    expect(contacts[0]).not.toHaveProperty('phone');
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
