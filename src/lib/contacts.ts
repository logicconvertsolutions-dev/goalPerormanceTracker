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
 * Matching order: a case-insensitive exact match on `(agent_id, lower(full_name))`
 * (matches `contacts_agent_name_uq`) first — phone is optional (compliance:
 * we no longer require it), so name is the only identifier guaranteed to
 * exist. Falls back to a phone match (`contacts_agent_phone_uq` on
 * normalized digits) only when no name match was found and a phone was
 * given, to still catch e.g. a contact re-imported under a slightly
 * different spelling of their name. A phone match backfills a missing phone
 * onto the name-matched record.
 */
export async function findOrCreateContact(
  supabase: SupabaseClient<Database>,
  agentId: string,
  orgId: string,
  fullName: string,
  contactId?: string | null,
  phone?: string | null
): Promise<{ id: string; created: boolean } | { error: string }> {
  if (contactId) {
    const { data: existing } = await supabase
      .from('contacts')
      .select('id')
      .eq('id', contactId)
      .eq('agent_id', agentId)
      .maybeSingle();
    if (existing) return { id: existing.id, created: false };
    // Picked id no longer belongs to this agent (stale/tampered) — fall
    // through to name matching rather than failing the whole submission.
  }

  const trimmed = fullName.trim();
  if (!trimmed) return { error: 'Contact name is required.' };

  const normalizedPhone = normalizePhone(phone);

  // Match the unique index's semantics exactly (lower(full_name) equality) —
  // ilike would also treat literal % and _ in the name as wildcards.
  const { data: byName } = await supabase
    .from('contacts')
    .select('id, phone')
    .eq('agent_id', agentId)
    .filter('full_name', 'ilike', trimmed.replace(/[%_]/g, '\\$&'))
    .maybeSingle();

  if (byName) {
    if (normalizedPhone && !byName.phone) {
      await supabase.from('contacts').update({ phone }).eq('id', byName.id);
    }
    return { id: byName.id, created: false };
  }

  if (normalizedPhone) {
    const { data: byPhone } = await supabase
      .from('contacts')
      .select('id')
      .eq('agent_id', agentId)
      .eq('phone_normalized', normalizedPhone)
      .maybeSingle();
    if (byPhone) return { id: byPhone.id, created: false };
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
  return { id: created.id, created: true };
}
