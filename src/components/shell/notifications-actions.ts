'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requireAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';

type Result = { ok: true } | { ok: false; error: string };

const markReadSchema = z.array(z.string().uuid()).max(200).optional();

/** Marks the given notifications (or every unread one) as read. Only
 * read_at and cleared_at are writable on notifications (P30/P31 migrations). */
export async function markNotificationsReadAction(ids?: string[]): Promise<Result> {
  const parsed = markReadSchema.safeParse(ids);
  if (!parsed.success) return { ok: false, error: 'Invalid request.' };
  const session = await requireAgent();
  const supabase = await createClient();

  let query = supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('agent_id', session.agent!.id)
    .is('read_at', null);
  if (parsed.data) query = query.in('id', parsed.data);
  const { error } = await query;

  revalidatePath('/', 'layout');
  return error ? { ok: false, error: 'Could not update notifications.' } : { ok: true };
}

/** Clears the given notifications (or all of them) from the bell. A soft
 * clear (cleared_at, P31) that also marks them read -- see the P31
 * migration for why the rows are not deleted. */
export async function clearNotificationsAction(ids?: string[]): Promise<Result> {
  const parsed = markReadSchema.safeParse(ids);
  if (!parsed.success) return { ok: false, error: 'Invalid request.' };
  const session = await requireAgent();
  const supabase = await createClient();

  const now = new Date().toISOString();
  let query = supabase
    .from('notifications')
    .update({ cleared_at: now, read_at: now })
    .eq('agent_id', session.agent!.id)
    .is('cleared_at', null);
  if (parsed.data) query = query.in('id', parsed.data);
  const { error } = await query;

  revalidatePath('/', 'layout');
  return error ? { ok: false, error: 'Could not clear notifications.' } : { ok: true };
}

// The browser's PushSubscription.toJSON() shape.
const subscriptionSchema = z.object({
  endpoint: z.string().url().startsWith('https://').max(1000),
  keys: z.object({
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(100),
  }),
});

export async function savePushSubscriptionAction(input: unknown, userAgent?: string): Promise<Result> {
  const parsed = subscriptionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'This browser returned an invalid subscription.' };
  await requireAgent();
  const supabase = await createClient();

  const { error } = await supabase.rpc('save_push_subscription', {
    p_endpoint: parsed.data.endpoint,
    p_p256dh: parsed.data.keys.p256dh,
    p_auth: parsed.data.keys.auth,
    p_user_agent: userAgent?.slice(0, 300),
  });
  return error ? { ok: false, error: 'Could not turn on notifications — try again.' } : { ok: true };
}

export async function deletePushSubscriptionAction(endpoint: string): Promise<Result> {
  const parsed = z.string().url().max(1000).safeParse(endpoint);
  if (!parsed.success) return { ok: false, error: 'Invalid request.' };
  await requireAgent();
  const supabase = await createClient();

  const { error } = await supabase.rpc('delete_push_subscription', { p_endpoint: parsed.data });
  return error ? { ok: false, error: 'Could not turn off notifications — try again.' } : { ok: true };
}
