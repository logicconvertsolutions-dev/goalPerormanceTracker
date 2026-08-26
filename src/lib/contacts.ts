import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../types/database';

/** Digits-only form used for matching — mirrors the DB's generated `phone_normalized` column. */
export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  return digits === '' ? null : digits;
}

/**
 * Resolves the contact for an activity log. When `contactId` is set (the
 * caller picked an existing contact from the autocomplete), it is trusted
 * directly — no name matching — which is what actually prevents duplicates;
 * the matching below is only a safety net for free-typed names/imports.
 *
 * Matching order: phone first (when provided — the more reliable identifier,
 * matches the `contacts_agent_phone_uq` unique index on normalized digits),
 * then a case-insensitive exact match on `(agent_id, lower(full_name))`
 * (matches `contacts_agent_name_uq`), else creates a new contact. A phone
 * match backfills a missing phone on a name-only contact found this way.
 */
export async function findOrCreateContact(
  supabase: SupabaseClient<Database>,
  agentId: string,
  orgId: string,
  fullName: string,
  contactId?: string | null,
  phone?: string | null
): Promise<{ id: string } | { error: string }> {
  if (contactId) {
    const { data: existing } = await supabase
      .from('contacts')
      .select('id')
      .eq('id', contactId)
      .eq('agent_id', agentId)
      .maybeSingle();
    if (existing) return { id: existing.id };
    // Picked id no longer belongs to this agent (stale/tampered) — fall
    // through to name matching rather than failing the whole submission.
  }

  const trimmed = fullName.trim();
  if (!trimmed) return { error: 'Contact name is required.' };

  const normalizedPhone = normalizePhone(phone);

  if (normalizedPhone) {
    const { data: byPhone } = await supabase
      .from('contacts')
      .select('id, phone')
      .eq('agent_id', agentId)
      .eq('phone_normalized', normalizedPhone)
      .maybeSingle();
    if (byPhone) return { id: byPhone.id };
  }

  // Match the unique index's semantics exactly (lower(full_name) equality) —
  // ilike would also treat literal % and _ in the name as wildcards.
  const { data: existing } = await supabase
    .from('contacts')
    .select('id, phone')
    .eq('agent_id', agentId)
    .filter('full_name', 'ilike', trimmed.replace(/[%_]/g, '\\$&'))
    .maybeSingle();

  if (existing) {
    if (normalizedPhone && !existing.phone) {
      await supabase.from('contacts').update({ phone }).eq('id', existing.id);
    }
    return { id: existing.id };
  }

  const { data: created, error } = await supabase
    .from('contacts')
    .insert({ agent_id: agentId, org_id: orgId, full_name: trimmed, phone: phone || null })
    .select('id')
    .single();

  if (error || !created) {
    console.error('findOrCreateContact: insert failed', error);
    return { error: 'Could not save contact.' };
  }
  return { id: created.id };
}
