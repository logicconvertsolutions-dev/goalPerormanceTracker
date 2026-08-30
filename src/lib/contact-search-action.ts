'use server';

import { requireAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';

export interface ContactSearchResult {
  id: string;
  full_name: string;
  /** Source of this contact's most recent call, if any — lets the Log Call
   * form auto-fill Source instead of asking again once it's already known. */
  last_call_source: string | null;
}

/** Backs the ContactPicker autocomplete — existing contacts only, this agent's own. */
export async function searchContactsAction(query: string): Promise<ContactSearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const session = await requireAgent();
  const supabase = await createClient();

  const escaped = trimmed.replace(/[%_]/g, '\\$&');
  const { data: contacts } = await supabase
    .from('contacts')
    .select('id, full_name')
    .eq('agent_id', session.agent!.id)
    .ilike('full_name', `%${escaped}%`)
    .order('full_name', { ascending: true })
    .limit(8);

  if (!contacts || contacts.length === 0) return [];

  const { data: calls } = await supabase
    .from('call_logs')
    .select('contact_id, source, call_date')
    .in('contact_id', contacts.map((c) => c.id))
    .order('call_date', { ascending: false });

  // First occurrence per contact wins — calls come back ordered newest first.
  const lastSourceByContact = new Map<string, string>();
  for (const call of calls ?? []) {
    if (!lastSourceByContact.has(call.contact_id)) {
      lastSourceByContact.set(call.contact_id, call.source);
    }
  }

  return contacts.map((c) => ({
    ...c,
    last_call_source: lastSourceByContact.get(c.id) ?? null,
  }));
}
