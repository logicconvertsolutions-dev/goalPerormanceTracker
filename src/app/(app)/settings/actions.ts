'use server';

import { z } from 'zod';
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
