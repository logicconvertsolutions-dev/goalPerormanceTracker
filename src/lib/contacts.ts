import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../types/database';

/**
 * Resolves the contact for an activity log. When `contactId` is set (the
 * caller picked an existing contact from the autocomplete), it is trusted
 * directly — no name matching — which is what actually prevents duplicates;
 * the name-matching path below is only a safety net for free-typed names.
 * Falls back to a case-insensitive match on `(agent_id, lower(full_name))`
 * (matches the `contacts_agent_name_uq` unique index), or creates one.
 */
export async function findOrCreateContact(
  supabase: SupabaseClient<Database>,
  agentId: string,
  orgId: string,
  fullName: string,
  contactId?: string | null
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

  // Match the unique index's semantics exactly (lower(full_name) equality) —
  // ilike would also treat literal % and _ in the name as wildcards.
  const { data: existing } = await supabase
    .from('contacts')
    .select('id')
    .eq('agent_id', agentId)
    .filter('full_name', 'ilike', trimmed.replace(/[%_]/g, '\\$&'))
    .maybeSingle();

  if (existing) return { id: existing.id };

  const { data: created, error } = await supabase
    .from('contacts')
    .insert({ agent_id: agentId, org_id: orgId, full_name: trimmed })
    .select('id')
    .single();

  if (error || !created) return { error: 'Could not save contact.' };
  return { id: created.id };
}
