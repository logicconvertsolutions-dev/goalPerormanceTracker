'use server';

import { requireAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';

export interface ContactSearchResult {
  id: string;
  full_name: string;
}

/** Backs the ContactPicker autocomplete — existing contacts only, this agent's own. */
export async function searchContactsAction(query: string): Promise<ContactSearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const session = await requireAgent();
  const supabase = await createClient();

  const escaped = trimmed.replace(/[%_]/g, '\\$&');
  const { data } = await supabase
    .from('contacts')
    .select('id, full_name')
    .eq('agent_id', session.agent!.id)
    .ilike('full_name', `%${escaped}%`)
    .order('full_name', { ascending: true })
    .limit(8);

  return data ?? [];
}
