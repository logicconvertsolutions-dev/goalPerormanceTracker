import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../types/database';

/**
 * Finds the caller's existing contact by case-insensitive name, or creates
 * one. Matches the `contacts_agent_name_uq` unique index on
 * `(agent_id, lower(full_name))` — "bharadwaj" and "Bharadwaj" resolve to the
 * same contact rather than creating two.
 */
export async function findOrCreateContact(
  supabase: SupabaseClient<Database>,
  agentId: string,
  orgId: string,
  fullName: string,
  company?: string | null
): Promise<{ id: string } | { error: string }> {
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
    .insert({ agent_id: agentId, org_id: orgId, full_name: trimmed, company: company || null })
    .select('id')
    .single();

  if (error || !created) {
    console.error('findOrCreateContact: insert failed', error);
    return { error: 'Could not save contact.' };
  }
  return { id: created.id };
}
