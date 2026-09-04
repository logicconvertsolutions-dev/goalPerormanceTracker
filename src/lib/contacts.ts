import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../types/database';

/**
 * Resolves the contact for an activity log. When `contactId` is set (the
 * caller picked an existing contact from the autocomplete), it is trusted
 * directly — no name matching — which is what actually prevents duplicates;
 * the matching below is only a safety net for free-typed names/imports.
 *
 * Matching: a case-insensitive exact match on `(agent_id, lower(full_name))`
 * (matches `contacts_agent_name_uq`) — name is the only identifier a contact
 * has (phone is deliberately not collected).
 */
export async function findOrCreateContact(
  supabase: SupabaseClient<Database>,
  agentId: string,
  orgId: string,
  fullName: string,
  contactId?: string | null,
  notes?: string | null
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

  // Match the unique index's semantics exactly (lower(full_name) equality) —
  // ilike would also treat literal % and _ in the name as wildcards.
  const { data: byName } = await supabase
    .from('contacts')
    .select('id')
    .eq('agent_id', agentId)
    .filter('full_name', 'ilike', trimmed.replace(/[%_]/g, '\\$&'))
    .maybeSingle();

  if (byName) return { id: byName.id, created: false };

  const { data: created, error } = await supabase
    .from('contacts')
    .insert({ agent_id: agentId, org_id: orgId, full_name: trimmed, notes: notes || null })
    .select('id')
    .single();

  if (error || !created) {
    console.error('findOrCreateContact: insert failed', error);
    return { error: 'Could not save contact.' };
  }
  return { id: created.id, created: true };
}
