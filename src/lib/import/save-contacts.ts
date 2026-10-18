import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../../types/database';

// Postgres unique-violation error code.
const UNIQUE_VIOLATION = '23505';
const INSERT_CHUNK_SIZE = 200;
// PostgREST caps every response at the project's max_rows (1000). Reading an
// agent's contacts in one request silently stopped at 1000, so on an agent
// with more, every name past the first thousand looked new, its insert hit
// contacts_agent_name_uq, and that took the other 199 names in the chunk down
// with it -- "only some of my contacts imported" (2026-10-17). Page instead.
const PAGE_SIZE = 1000;
// Bounded parallelism for one-row writes (phone/notes backfill, the per-row
// fallback below) so a few hundred of them stay well inside the action's
// time limit without opening hundreds of requests at once.
const ROW_CONCURRENCY = 10;

export interface ContactInput {
  fullName: string;
  phoneNumber: string | null;
  notes?: string | null;
}

export interface SaveContactsResult {
  /** lower(full_name) -> contact id, for every name that was saved or matched. */
  idsByName: Map<string, string>;
  /** Distinct names that became a new contact. */
  created: number;
  /** Distinct names the agent already had. */
  existing: number;
  /** Distinct names that could not be saved. */
  failed: number;
}

interface ExistingContact {
  id: string;
  full_name: string;
  phone_number: string | null;
  notes: string | null;
}

/** All of the agent's contacts, a page at a time (see PAGE_SIZE). */
export async function fetchAllContacts(
  supabase: SupabaseClient<Database>,
  agentId: string
): Promise<ExistingContact[]> {
  const rows: ExistingContact[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('contacts')
      .select('id, full_name, phone_number, notes')
      .eq('agent_id', agentId)
      .order('id')
      .range(from, from + PAGE_SIZE - 1);
    // A failed read must not look like "no contacts": every name would then
    // be inserted as new and collide.
    if (error) throw new Error(`fetchAllContacts: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

async function eachLimited<T>(items: T[], fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += ROW_CONCURRENCY) {
    await Promise.all(items.slice(i, i + ROW_CONCURRENCY).map(fn));
  }
}

/**
 * Matches each input to the agent's contacts by name (case-insensitive, as
 * contacts_agent_name_uq does) and creates the ones that are new, in bulk.
 * An existing contact only gains a phone number or notes it doesn't have --
 * an import never replaces what the agent already saved. `supabase` must be
 * the user's own client so RLS pins every write to auth.uid().
 *
 * A chunk that still hits a unique violation (a contact saved by another
 * request in the meantime) is retried a row at a time, so one name never
 * costs the other 199 in its chunk.
 */
export async function saveContacts(
  supabase: SupabaseClient<Database>,
  agentId: string,
  orgId: string,
  inputs: ContactInput[]
): Promise<SaveContactsResult> {
  const result: SaveContactsResult = { idsByName: new Map(), created: 0, existing: 0, failed: 0 };

  const byName = new Map<string, ExistingContact>();
  for (const row of await fetchAllContacts(supabase, agentId)) {
    byName.set(row.full_name.toLowerCase(), row);
  }

  const pending = new Map<string, ContactInput>();
  const phoneBackfill = new Map<string, string>(); // contact id -> number
  const notesBackfill = new Map<string, string>(); // contact id -> notes

  for (const input of inputs) {
    const fullName = input.fullName.trim();
    if (!fullName) continue;
    const key = fullName.toLowerCase();

    const existing = byName.get(key);
    if (existing) {
      if (!result.idsByName.has(key)) {
        result.idsByName.set(key, existing.id);
        result.existing += 1;
      }
      if (input.phoneNumber && !existing.phone_number && !phoneBackfill.has(existing.id)) {
        phoneBackfill.set(existing.id, input.phoneNumber);
      }
      if (input.notes && !existing.notes && !notesBackfill.has(existing.id)) {
        notesBackfill.set(existing.id, input.notes);
      }
      continue;
    }

    // Two inputs sharing a name become one contact; the first number/notes win.
    const seen = pending.get(key);
    if (seen) {
      seen.phoneNumber ??= input.phoneNumber;
      seen.notes ??= input.notes ?? null;
      continue;
    }
    pending.set(key, { fullName, phoneNumber: input.phoneNumber, notes: input.notes ?? null });
  }

  const toInsert = Array.from(pending.values());
  for (let i = 0; i < toInsert.length; i += INSERT_CHUNK_SIZE) {
    const chunk = toInsert.slice(i, i + INSERT_CHUNK_SIZE);
    const { data, error } = await supabase
      .from('contacts')
      .insert(chunk.map((c) => insertRow(c, agentId, orgId)))
      .select('id, full_name');

    if (!error && data) {
      for (const c of data) result.idsByName.set(c.full_name.toLowerCase(), c.id);
      result.created += data.length;
      continue;
    }

    if (error?.code !== UNIQUE_VIOLATION) {
      console.error('saveContacts: bulk contact insert failed', error);
      result.failed += chunk.length;
      continue;
    }

    await eachLimited(chunk, async (c) => {
      const key = c.fullName.toLowerCase();
      const { data: single, error: rowError } = await supabase
        .from('contacts')
        .insert(insertRow(c, agentId, orgId))
        .select('id')
        .single();
      if (single) {
        result.idsByName.set(key, single.id);
        result.created += 1;
        return;
      }
      if (rowError?.code === UNIQUE_VIOLATION) {
        // Saved by someone else since the read above -- it exists, use it.
        const { data: winner } = await supabase
          .from('contacts')
          .select('id')
          .eq('agent_id', agentId)
          .filter('full_name', 'ilike', c.fullName.replace(/[%_\\]/g, '\\$&'))
          .maybeSingle();
        if (winner) {
          result.idsByName.set(key, winner.id);
          result.existing += 1;
          return;
        }
      }
      console.error('saveContacts: per-row contact insert failed', rowError);
      result.failed += 1;
    });
  }

  // `is null` keeps a value saved by someone else in the meantime.
  await eachLimited(Array.from(phoneBackfill), async ([id, phoneNumber]) => {
    await supabase
      .from('contacts')
      .update({ phone_number: phoneNumber })
      .eq('id', id)
      .eq('agent_id', agentId)
      .is('phone_number', null);
  });
  await eachLimited(Array.from(notesBackfill), async ([id, notes]) => {
    await supabase.from('contacts').update({ notes }).eq('id', id).eq('agent_id', agentId).is('notes', null);
  });

  return result;
}

function insertRow(c: ContactInput, agentId: string, orgId: string) {
  return {
    agent_id: agentId,
    org_id: orgId,
    full_name: c.fullName,
    phone_number: c.phoneNumber,
    notes: c.notes ?? null,
  };
}
