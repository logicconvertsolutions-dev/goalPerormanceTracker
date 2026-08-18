'use server';

import { revalidatePath } from 'next/cache';
import { requireAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { addDays } from '@/lib/dates';

export async function snoozeFollowUpAction(callLogId: string, days: number) {
  const session = await requireAgent();
  const supabase = await createClient();

  const { data: row } = await supabase
    .from('call_logs')
    .select('follow_up_on')
    .eq('id', callLogId)
    .eq('agent_id', session.agent!.id)
    .maybeSingle();

  if (!row?.follow_up_on) return { ok: false, error: 'Follow-up not found.' };

  const { error } = await supabase
    .from('call_logs')
    .update({ follow_up_on: addDays(row.follow_up_on, days) })
    .eq('id', callLogId)
    .eq('agent_id', session.agent!.id);

  revalidatePath('/today');
  return { ok: !error };
}

export async function markFollowUpDoneAction(callLogId: string) {
  const session = await requireAgent();
  const supabase = await createClient();

  const { error } = await supabase
    .from('call_logs')
    .update({ follow_up_done_at: new Date().toISOString() })
    .eq('id', callLogId)
    .eq('agent_id', session.agent!.id);

  revalidatePath('/today');
  return { ok: !error };
}
