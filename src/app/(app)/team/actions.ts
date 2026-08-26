'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireLeader } from '@/lib/auth/guards';
import { composeNudge, composeTrainingReminder } from '@/lib/notifications/compose';
import { sendEmail } from '@/lib/notifications/send';

const nudgeSchema = z.object({ agentId: z.string().uuid() });

// Rate limiting and authorization live entirely in nudge_agent (leader/admin,
// in-downline, one nudge per agent per 7 days -- 20260818234435_p5a). Once
// that RPC accepts the nudge, the email send is best-effort: a delivery
// failure shouldn't undo the rate-limit record or report the click as failed.
export async function nudgeAgentAction(agentId: string) {
  const parsed = nudgeSchema.safeParse({ agentId });
  if (!parsed.success) return { ok: false, message: 'Invalid agent' };

  const session = await requireLeader();
  const supabase = await createClient();
  const { error } = await supabase.rpc('nudge_agent', { p_agent_id: parsed.data.agentId });

  revalidatePath('/team');
  if (error) return { ok: false, message: error.message };

  try {
    const admin = createAdminClient();
    const { data: agent } = await admin
      .from('agents')
      .select('id, email, full_name, time_zone')
      .eq('id', parsed.data.agentId)
      .single();
    if (agent) {
      const composed = await composeNudge(admin, agent, session.agent!.full_name);
      if (composed) {
        await sendEmail({
          to: composed.to,
          subject: composed.content.subject,
          html: composed.content.html,
          text: composed.content.text,
        });
      }
    }
  } catch (err) {
    console.error('[notifications] failed to send nudge email', err);
  }

  return { ok: true };
}

// Rate limiting and authorization live entirely in send_training_reminder
// (leader/admin, in-downline, one reminder per agent per 7 days — same shape
// as nudge_agent, separate table/cooldown, 20260826091500_p9b). Distinct
// from nudgeAgentAction: this is a training reminder, not an activity nudge.
export async function sendTrainingReminderAction(agentId: string) {
  const parsed = nudgeSchema.safeParse({ agentId });
  if (!parsed.success) return { ok: false, message: 'Invalid agent' };

  const session = await requireLeader();
  const supabase = await createClient();
  const { error } = await supabase.rpc('send_training_reminder', { p_agent_id: parsed.data.agentId });

  revalidatePath('/team');
  revalidatePath('/team/members');
  if (error) return { ok: false, message: error.message };

  try {
    const admin = createAdminClient();
    const { data: agent } = await admin
      .from('agents')
      .select('id, email, full_name, time_zone')
      .eq('id', parsed.data.agentId)
      .single();
    if (agent) {
      const composed = await composeTrainingReminder(agent, session.agent!.full_name);
      await sendEmail({
        to: composed.to,
        subject: composed.content.subject,
        html: composed.content.html,
        text: composed.content.text,
      });
    }
  } catch (err) {
    console.error('[notifications] failed to send training reminder email', err);
  }

  return { ok: true };
}
