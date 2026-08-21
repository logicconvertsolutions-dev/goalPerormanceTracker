'use server';

import { z } from 'zod';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

const prefsSchema = z.object({
  eveningNudge: z.boolean(),
  sundaySummary: z.boolean(),
  mondayDigest: z.boolean(),
});

export async function updateNotificationPrefsAction(
  input: z.infer<typeof prefsSchema>
) {
  const parsed = prefsSchema.safeParse(input);
  if (!parsed.success) return { ok: false };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false };

  const { error } = await supabase.from('notification_prefs').upsert({
    agent_id: user.id,
    evening_nudge: parsed.data.eveningNudge,
    sunday_summary: parsed.data.sundaySummary,
    monday_digest: parsed.data.mondayDigest,
    updated_at: new Date().toISOString(),
  });

  revalidatePath('/settings');
  return { ok: !error };
}

const timeZoneSchema = z.object({ timeZone: z.string().min(1) });

export async function updateTimeZoneAction(timeZone: string) {
  const parsed = timeZoneSchema.safeParse({ timeZone });
  if (!parsed.success) return { ok: false };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false };

  const { error } = await supabase
    .from('agents')
    .update({ time_zone: parsed.data.timeZone })
    .eq('id', user.id);

  revalidatePath('/settings');
  return { ok: !error };
}

// "Delete my account" (09-account-and-auth.md /settings "Your data"):
// public.delete_my_account() (p6b) does the actual work -- deletes
// contacts (cascading call_logs/appointments), scrubs sales/recruiting_logs
// notes, anonymises the agent row, and sets status inactive. Signing out
// here is what actually ends the session; the RPC alone doesn't invalidate
// the current cookie.
export async function deleteMyAccountAction() {
  const supabase = await createClient();
  const { error } = await supabase.rpc('delete_my_account');
  if (error) return { ok: false, error: error.message };

  await supabase.auth.signOut();
  redirect('/login?reason=account-deleted');
}
