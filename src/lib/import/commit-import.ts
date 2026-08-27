import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../../types/database';
import { findOrCreateContact } from '@/lib/contacts';
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

/**
 * Writes parsed rows for `agentId`/`orgId` only. `supabase` must be an
 * authenticated client (never the service-role admin client) so RLS's
 * `agent_id = auth.uid()` check is what actually enforces "import writes
 * only to auth.uid()'s rows regardless of file contents" — structural, not
 * conventional.
 *
 * Idempotency relies on the existing partial unique index
 * `(agent_id, import_row_hash) where import_row_hash is not null` on each
 * activity table. PostgREST's `.upsert(..., { onConflict })` can't target a
 * partial index (Postgres rejects it: "no unique or exclusion constraint
 * matching the ON CONFLICT specification", since the arbiter must include
 * the index's WHERE predicate, which onConflict has no way to express) — so
 * re-uploading the same file is instead a plain insert that catches the
 * resulting 23505 unique-violation and treats it as a skipped duplicate.
 */
export async function commitImport(
  supabase: SupabaseClient<Database>,
  agentId: string,
  orgId: string,
  rows: ParsedRow[]
): Promise<CommitResult> {
  const result: CommitResult = { imported: 0, skippedDuplicate: 0, errors: [] };

  for (const row of rows) {
    if (row.errors.length > 0 || !row.data) {
      result.errors.push({ sheet: row.sheet, rowNumber: row.rowNumber, message: row.errors.join(' ') });
      continue;
    }

    const outcome = await commitOne(supabase, agentId, orgId, row);
    if (outcome === 'imported') result.imported += 1;
    else if (outcome === 'duplicate') result.skippedDuplicate += 1;
    else result.errors.push({ sheet: row.sheet, rowNumber: row.rowNumber, message: outcome.message });
  }

  return result;
}

type CommitOutcome = 'imported' | 'duplicate' | { message: string };

async function commitOne(
  supabase: SupabaseClient<Database>,
  agentId: string,
  orgId: string,
  row: ParsedRow
): Promise<CommitOutcome> {
  switch (row.sheet) {
    case 'Contacts':
      return commitContactOnly(supabase, agentId, orgId, row.data as ContactOnlyImportData);
    case 'Call Log':
      return commitCallLog(supabase, agentId, orgId, row.data as CallLogImportData, row.rowHash);
    case 'Appointment Log':
      return commitAppointment(supabase, agentId, orgId, row.data as AppointmentImportData, row.rowHash);
    case 'Sales Log':
      return commitSale(supabase, agentId, orgId, row.data as SalesImportData, row.rowHash);
    case 'Recruiting Log':
      return commitRecruitingLog(supabase, agentId, orgId, row.data as RecruitingImportData, row.rowHash);
  }
}

// No activity row, so no import_row_hash to dedupe on -- idempotency instead
// comes entirely from findOrCreateContact's phone/name matching (re-uploading
// the same contact list just resolves to the same rows, never duplicates).
async function commitContactOnly(
  supabase: SupabaseClient<Database>,
  agentId: string,
  orgId: string,
  data: ContactOnlyImportData
): Promise<CommitOutcome> {
  const contact = await findOrCreateContact(supabase, agentId, orgId, data.fullName, null, data.phone);
  if ('error' in contact) return { message: contact.error };
  return 'imported';
}

async function commitCallLog(
  supabase: SupabaseClient<Database>,
  agentId: string,
  orgId: string,
  data: CallLogImportData,
  rowHash: string
): Promise<CommitOutcome> {
  const contact = await findOrCreateContact(supabase, agentId, orgId, data.contactName, null, data.contactPhone);
  if ('error' in contact) return { message: contact.error };

  const { error } = await supabase.from('call_logs').insert({
    agent_id: agentId,
    org_id: orgId,
    contact_id: contact.id,
    call_date: data.callDate,
    source: data.source,
    outcome: data.outcome,
    notes: data.notes,
    import_row_hash: rowHash,
  });

  if (!error) return 'imported';
  if (error.code === UNIQUE_VIOLATION) return 'duplicate';
  return { message: 'Could not import call.' };
}

async function commitAppointment(
  supabase: SupabaseClient<Database>,
  agentId: string,
  orgId: string,
  data: AppointmentImportData,
  rowHash: string
): Promise<CommitOutcome> {
  const contact = await findOrCreateContact(supabase, agentId, orgId, data.contactName, null, data.contactPhone);
  if ('error' in contact) return { message: contact.error };

  const { error } = await supabase.from('appointments').insert({
    agent_id: agentId,
    org_id: orgId,
    contact_id: contact.id,
    appt_date: data.apptDate,
    appt_type: data.apptType,
    status: data.status,
    expected_premium_cents: data.expectedPremiumCents,
    referrals_given: data.referralsGiven,
    notes: data.notes,
    import_row_hash: rowHash,
  });

  if (!error) return 'imported';
  if (error.code === UNIQUE_VIOLATION) return 'duplicate';
  return { message: 'Could not import appointment.' };
}

async function commitSale(
  supabase: SupabaseClient<Database>,
  agentId: string,
  orgId: string,
  data: SalesImportData,
  rowHash: string
): Promise<CommitOutcome> {
  const contact = await findOrCreateContact(supabase, agentId, orgId, data.clientName, null, data.contactPhone);
  if ('error' in contact) return { message: contact.error };

  const { error } = await supabase.from('sales').insert({
    agent_id: agentId,
    org_id: orgId,
    contact_id: contact.id,
    sale_date: data.saleDate,
    product_type: data.productType,
    premium_cents: data.premiumCents,
    notes: data.notes,
    import_row_hash: rowHash,
  });

  if (!error) return 'imported';
  if (error.code === UNIQUE_VIOLATION) return 'duplicate';
  return { message: 'Could not import sale.' };
}

async function commitRecruitingLog(
  supabase: SupabaseClient<Database>,
  agentId: string,
  orgId: string,
  data: RecruitingImportData,
  rowHash: string
): Promise<CommitOutcome> {
  const contact = await findOrCreateContact(supabase, agentId, orgId, data.prospectName, null, data.contactPhone);
  if ('error' in contact) return { message: contact.error };

  const { error } = await supabase.from('recruiting_logs').insert({
    agent_id: agentId,
    org_id: orgId,
    contact_id: contact.id,
    log_date: data.logDate,
    source: data.source,
    status: data.status,
    notes: data.notes,
    import_row_hash: rowHash,
  });

  if (!error) return 'imported';
  if (error.code === UNIQUE_VIOLATION) return 'duplicate';
  return { message: 'Could not import recruiting log.' };
}
