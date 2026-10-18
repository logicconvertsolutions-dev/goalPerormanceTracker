// In-memory stand-in for the subset of the Supabase query builder the import
// code uses -- including Postgres's real "one bad row aborts the whole
// multi-row INSERT statement" behavior and PostgREST's 1000-row response cap,
// so the pre-filter/fallback/paging paths run the way they would against a
// real database. No local Supabase needed.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../types/database';

const MAX_ROWS = 1000;

type Row = Record<string, unknown>;

export class FakeQuery implements PromiseLike<{ data: Row[] | null; error: { code: string } | null }> {
  private filters: { kind: 'eq' | 'in' | 'is' | 'ilike'; col: string; val: unknown }[] = [];
  private orderCol: string | null = null;
  private rangeFrom: number | null = null;
  private rangeTo = 0;
  private singleRow = false;
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
  is(col: string, val: unknown) {
    this.filters.push({ kind: 'is', col, val });
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
  filter(col: string, op: string, val: string) {
    if (op !== 'ilike') throw new Error(`fake filter: unsupported op ${op}`);
    this.filters.push({ kind: 'ilike', col, val });
    return this;
  }
  order(col: string) {
    this.orderCol = col;
    return this;
  }
  range(from: number, to: number) {
    this.rangeFrom = from;
    this.rangeTo = to;
    return this;
  }
  maybeSingle() {
    this.singleRow = true;
    return this;
  }
  single() {
    this.singleRow = true;
    return this;
  }

  private matches(row: Row): boolean {
    return this.filters.every((f) => {
      if (f.kind === 'eq') return row[f.col] === f.val;
      if (f.kind === 'is') return (row[f.col] ?? null) === f.val;
      if (f.kind === 'ilike') {
        // Exact case-insensitive match once the escapes are undone; no
        // caller here uses an unescaped wildcard.
        const want = String(f.val).replace(/\\(.)/g, '$1').toLowerCase();
        return String(row[f.col]).toLowerCase() === want;
      }
      return (f.val as unknown[]).includes(row[f.col]);
    });
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
      let rows = this.table.filter((r) => this.matches(r));
      if (this.orderCol) {
        const col = this.orderCol;
        rows = [...rows].sort((a, b) => String(a[col]).localeCompare(String(b[col])));
      }
      // PostgREST never returns more than max_rows (1000) per request -- the
      // cap that silently truncated the old one-shot contact read.
      rows =
        this.rangeFrom === null ? rows.slice(0, MAX_ROWS) : rows.slice(this.rangeFrom, Math.min(this.rangeTo + 1, this.rangeFrom + MAX_ROWS));
      return this.finish(this.project(rows));
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
    return this.finish(this.project(inserted));
  }

  // .single()/.maybeSingle() hand back one row (typed loosely, like the rest
  // of this fake).
  private finish(rows: Row[]): { data: Row[] | null; error: { code: string } | null } {
    if (!this.singleRow) return { data: rows, error: null };
    return { data: (rows[0] ?? null) as unknown as Row[] | null, error: null };
  }

  then<TResult1, TResult2 = never>(
    onfulfilled?: ((value: { data: Row[] | null; error: { code: string } | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

export class FakeSupabase {
  tables: Record<string, Row[]> = { contacts: [], call_logs: [], appointments: [], sales: [], recruiting_logs: [] };
  from(tableName: string) {
    return new FakeQuery(this.tables[tableName], tableName);
  }
}

export function fakeClient(): { client: SupabaseClient<Database>; fake: FakeSupabase } {
  const fake = new FakeSupabase();
  return { client: fake as unknown as SupabaseClient<Database>, fake };
}

