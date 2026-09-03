import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../../types/database';
import { normalizePhone } from '@/lib/contacts';
import type {
  AppointmentImportData,
  CallLogImportData,
  ContactOnlyImportData,
  ParsedRow,
  RecruitingImportData,
  SalesImportData,
} from './parse-workbook';

export interface CommitError {
  sheet: string;
  rowNumber: number;
  message: string;
}

export interface CommitResult {
  imported: number;
  skippedDuplicate: number;
  errors: CommitError[];
}

// Postgres unique-violation error code.
const UNIQUE_VIOLATION = '23505';
const INSERT_CHUNK_SIZE = 200;
// Postgres's own bound on IN-list/array size is much higher than this, but
// keeping select-by-hash and select-by-name lookups chunked too avoids ever
// building a single request with tens of thousands of bind values.
const LOOKUP_CHUNK_SIZE = 500;

type ActivityTable = 'call_logs' | 'appointments' | 'sales' | 'recruiting_logs';

interface ActivityRow {
  rowIndex: number;
  rowNumber: number;
  sheet: ParsedRow['sheet'];
  contactName: string;
  contactPhone: string | null;
  rowHash: string;
  insert: Record<string, unknown>;
}

/**
 * Writes parsed rows for `agentId`/`orgId` only. `supabase` must be an
 * authenticated client (never the service-role admin client) so RLS's
 * `agent_id = auth.uid()` check is what actually enforces "import writes
 * only to auth.uid()'s rows regardless of file contents" — structural, not
 * conventional.
 *
 * Idempotency relies on the existing partial unique index
 * `(agent_id, import_row_hash) where import_row_hash is not null` on each
 * activity table. This function pre-checks which hashes already exist
 * (see resolveDuplicateHashes) and only inserts the rest — see the note
 * there for why a plain onConflict upsert can't be used instead.
 *
 * Deliberately NOT a loop of one-row-at-a-time findOrCreateContact() + insert
 * calls: for a workbook with a few hundred rows across its five sheets, that
 * was up to 4 sequential DB round-trips per row (contact lookup(s), insert),
 * fully serial, inside a single server-action invocation -- for a large
 * import that reliably exceeded the platform's execution-time limit, which
 * from the UI just looked like "stuck on Importing…" forever. Instead this
 * resolves every row's contact in one bulk pass (see resolveContactsBulk)
 * and then bulk-inserts each activity table's rows in chunks.
 */
export async function commitImport(
  supabase: SupabaseClient<Database>,
  agentId: string,
  orgId: string,
  rows: ParsedRow[]
): Promise<CommitResult> {
  const result: CommitResult = { imported: 0, skippedDuplicate: 0, errors: [] };

  // Rows with parse errors never reach contact resolution or insertion.
  const validRows: { rowIndex: number; row: ParsedRow }[] = [];
  rows.forEach((row, rowIndex) => {
    if (row.errors.length > 0 || !row.data) {
      result.errors.push({ sheet: row.sheet, rowNumber: row.rowNumber, message: row.errors.join(' ') });
      return;
    }
    validRows.push({ rowIndex, row });
  });
  if (validRows.length === 0) return result;

  // One name/phone ref per valid row, in a single combined pass across every
  // sheet -- so e.g. the same person appearing in both Call Log and Sales
  // Log resolves to the same contact instead of two separate lookups/creates.
  const refs = validRows.map(({ rowIndex, row }) => ({ rowIndex, ...contactRefFor(row) }));
  const contactIdByRowIndex = await resolveContactsBulk(supabase, agentId, orgId, refs);

  // Split into "Contacts" sheet rows (nothing left to do once the contact
  // itself is resolved/created) and the four activity sheets (still need
  // their own table's row inserted, with the resolved contact_id attached).
  const activityBySheet = new Map<ActivityTable, ActivityRow[]>();
  for (const { rowIndex, row } of validRows) {
    if (row.sheet === 'Contacts') {
      if (contactIdByRowIndex.has(rowIndex)) result.imported += 1;
      else result.errors.push({ sheet: row.sheet, rowNumber: row.rowNumber, message: 'Could not save contact.' });
      continue;
    }

    const contactId = contactIdByRowIndex.get(rowIndex);
    if (!contactId) {
      result.errors.push({ sheet: row.sheet, rowNumber: row.rowNumber, message: 'Could not save contact.' });
      continue;
    }

    const table = ACTIVITY_TABLE_BY_SHEET[row.sheet];
    const list = activityBySheet.get(table) ?? [];
    list.push(activityRowFor(rowIndex, row, contactId, agentId, orgId));
    activityBySheet.set(table, list);
  }

  for (const [table, activityRows] of activityBySheet) {
    await commitActivityRows(supabase, table, activityRows, result);
  }

  return result;
}

const ACTIVITY_TABLE_BY_SHEET: Record<Exclude<ParsedRow['sheet'], 'Contacts'>, ActivityTable> = {
  'Call Log': 'call_logs',
  'Appointment Log': 'appointments',
  'Sales Log': 'sales',
  'Recruiting Log': 'recruiting_logs',
};

function contactRefFor(row: ParsedRow): { name: string; phone: string | null } {
  switch (row.sheet) {
    case 'Contacts': {
      const data = row.data as ContactOnlyImportData;
      return { name: data.fullName, phone: data.phone };
    }
    case 'Call Log': {
      const data = row.data as CallLogImportData;
      return { name: data.contactName, phone: data.contactPhone };
    }
    case 'Appointment Log': {
      const data = row.data as AppointmentImportData;
      return { name: data.contactName, phone: data.contactPhone };
    }
    case 'Sales Log': {
      const data = row.data as SalesImportData;
      return { name: data.clientName, phone: data.contactPhone };
    }
    case 'Recruiting Log': {
      const data = row.data as RecruitingImportData;
      return { name: data.prospectName, phone: data.contactPhone };
    }
  }
}

function activityRowFor(
  rowIndex: number,
  row: ParsedRow,
  contactId: string,
  agentId: string,
  orgId: string
): ActivityRow {
  const base = { agent_id: agentId, org_id: orgId, contact_id: contactId, import_row_hash: row.rowHash };
  const { name, phone } = contactRefFor(row);

  let insert: Record<string, unknown>;
  switch (row.sheet) {
    case 'Call Log': {
      const data = row.data as CallLogImportData;
      insert = { ...base, call_date: data.callDate, source: data.source, outcome: data.outcome, notes: data.notes };
      break;
    }
    case 'Appointment Log': {
      const data = row.data as AppointmentImportData;
      insert = {
        ...base,
        appt_date: data.apptDate,
        appt_type: data.apptType,
        status: data.status,
        expected_premium_cents: data.expectedPremiumCents,
        referrals_given: data.referralsGiven,
        notes: data.notes,
      };
      break;
    }
    case 'Sales Log': {
      const data = row.data as SalesImportData;
      insert = {
        ...base,
        sale_date: data.saleDate,
        product_type: data.productType,
        premium_cents: data.premiumCents,
        notes: data.notes,
      };
      break;
    }
    case 'Recruiting Log': {
      const data = row.data as RecruitingImportData;
      insert = { ...base, log_date: data.logDate, source: data.source, status: data.status, notes: data.notes };
      break;
    }
    default:
      throw new Error(`activityRowFor called for non-activity sheet: ${row.sheet}`);
  }

  return { rowIndex, rowNumber: row.rowNumber, sheet: row.sheet, contactName: name, contactPhone: phone, rowHash: row.rowHash, insert };
}

const ACTIVITY_ERROR_MESSAGE: Record<ActivityTable, string> = {
  call_logs: 'Could not import call.',
  appointments: 'Could not import appointment.',
  sales: 'Could not import sale.',
  recruiting_logs: 'Could not import recruiting log.',
};

/**
 * Bulk-inserts one activity table's rows, chunked, after pre-filtering out
 * rows whose import_row_hash already exists (a re-upload of the same file).
 * Pre-filtering rather than relying on catching a bulk unique-violation
 * matters here: a plain multi-row INSERT is one statement, so Postgres
 * aborts the *entire* chunk on any single row's conflict -- pre-filtering
 * keeps a mixed chunk (some already-imported rows, some new) from failing
 * the new rows too.
 */
async function commitActivityRows(
  supabase: SupabaseClient<Database>,
  table: ActivityTable,
  rows: ActivityRow[],
  result: CommitResult
): Promise<void> {
  const existingHashes = new Set<string>();
  const hashes = rows.map((r) => r.rowHash);
  for (let i = 0; i < hashes.length; i += LOOKUP_CHUNK_SIZE) {
    const chunk = hashes.slice(i, i + LOOKUP_CHUNK_SIZE);
    const { data } = await supabase.from(table).select('import_row_hash').in('import_row_hash', chunk);
    for (const r of data ?? []) {
      if (r.import_row_hash) existingHashes.add(r.import_row_hash);
    }
  }

  const toInsert = rows.filter((r) => !existingHashes.has(r.rowHash));
  result.skippedDuplicate += rows.length - toInsert.length;

  for (let i = 0; i < toInsert.length; i += INSERT_CHUNK_SIZE) {
    const chunk = toInsert.slice(i, i + INSERT_CHUNK_SIZE);
    const { error } = await supabase
      .from(table)
      .insert(chunk.map((r) => r.insert) as never[]);

    if (!error) {
      result.imported += chunk.length;
      continue;
    }

    if (error.code === UNIQUE_VIOLATION) {
      // Someone else imported an overlapping row between our pre-check and
      // this insert (or two rows in this same file share a hash, which
      // shouldn't happen since rowHash is derived from file+sheet+rowNumber)
      // -- fall back to one-by-one for just this chunk so a single collision
      // doesn't lose every other row in it.
      for (const r of chunk) {
        const { error: rowError } = await supabase.from(table).insert(r.insert as never);
        if (!rowError) result.imported += 1;
        else if (rowError.code === UNIQUE_VIOLATION) result.skippedDuplicate += 1;
        else result.errors.push({ sheet: r.sheet, rowNumber: r.rowNumber, message: ACTIVITY_ERROR_MESSAGE[table] });
      }
      continue;
    }

    console.error(`commitImport: bulk insert into ${table} failed`, error);
    for (const r of chunk) {
      result.errors.push({ sheet: r.sheet, rowNumber: r.rowNumber, message: ACTIVITY_ERROR_MESSAGE[table] });
    }
  }
}

/**
 * Resolves every row's contact in one bulk pass: fetch the agent's existing
 * contacts once, match each row against them in memory (name first, phone
 * as a fallback signal — same priority as findOrCreateContact, see
 * lib/contacts.ts for why), collapse rows that need a brand-new contact
 * down to one insert per unique name (so the same new person appearing on
 * multiple sheets/rows becomes a single contact, not several), and
 * bulk-insert those in chunks.
 */
async function resolveContactsBulk(
  supabase: SupabaseClient<Database>,
  agentId: string,
  orgId: string,
  refs: { rowIndex: number; name: string; phone: string | null }[]
): Promise<Map<number, string>> {
  const resolved = new Map<number, string>();
  if (refs.length === 0) return resolved;

  const { data: existingRows } = await supabase
    .from('contacts')
    .select('id, full_name, phone, phone_normalized')
    .eq('agent_id', agentId);

  const byName = new Map<string, { id: string; phone: string | null }>();
  const byPhone = new Map<string, { id: string; phone: string | null }>();
  for (const row of existingRows ?? []) {
    byName.set(row.full_name.toLowerCase(), row);
    if (row.phone_normalized) byPhone.set(row.phone_normalized, row);
  }

  const backfills: { id: string; phone: string }[] = [];
  const pendingByKey = new Map<string, { fullName: string; phone: string | null; rowIndices: number[] }>();

  for (const ref of refs) {
    const trimmed = ref.name.trim();
    if (!trimmed) continue; // parser already validated a name exists on every sheet; defensive only
    const nameKey = trimmed.toLowerCase();
    const normalizedPhone = normalizePhone(ref.phone);

    const existing = byName.get(nameKey) || (normalizedPhone ? byPhone.get(normalizedPhone) : undefined);
    if (existing) {
      resolved.set(ref.rowIndex, existing.id);
      if (normalizedPhone && !existing.phone) {
        backfills.push({ id: existing.id, phone: ref.phone! });
        existing.phone = ref.phone!;
      }
      continue;
    }

    const pending = pendingByKey.get(nameKey);
    if (pending) {
      pending.rowIndices.push(ref.rowIndex);
      if (!pending.phone && ref.phone) pending.phone = ref.phone;
      continue;
    }
    pendingByKey.set(nameKey, { fullName: trimmed, phone: ref.phone, rowIndices: [ref.rowIndex] });
  }

  const pendingEntries = Array.from(pendingByKey.entries());
  const toInsert = pendingEntries.map(([, p]) => ({
    agent_id: agentId,
    org_id: orgId,
    full_name: p.fullName,
    phone: p.phone || null,
  }));

  for (let i = 0; i < toInsert.length; i += INSERT_CHUNK_SIZE) {
    const chunk = toInsert.slice(i, i + INSERT_CHUNK_SIZE);
    const { data, error } = await supabase.from('contacts').insert(chunk).select('id, full_name');
    if (error || !data) {
      console.error('resolveContactsBulk: bulk contact insert failed', error);
      continue; // rows referencing these pending contacts stay unresolved -> reported as errors by the caller
    }
    const insertedByName = new Map(data.map((c) => [c.full_name.toLowerCase(), c.id]));
    for (const [nameKey, p] of pendingEntries.slice(i, i + INSERT_CHUNK_SIZE)) {
      const id = insertedByName.get(nameKey);
      if (id) for (const rowIndex of p.rowIndices) resolved.set(rowIndex, id);
    }
  }

  if (backfills.length > 0) {
    await Promise.all(backfills.map((b) => supabase.from('contacts').update({ phone: b.phone }).eq('id', b.id)));
  }

  return resolved;
}
