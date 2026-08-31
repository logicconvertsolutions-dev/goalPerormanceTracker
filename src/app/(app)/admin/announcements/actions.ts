'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { getSessionAgent } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';

const publishSchema = z.object({
  message: z.string().min(1).max(2000),
});

export async function publishAnnouncementAction(
  input: z.infer<typeof publishSchema>
): Promise<{ ok: boolean; error?: string }> {
  const session = await getSessionAgent();
  if (!session?.agent || session.agent.role !== 'admin') {
    return { ok: false, error: 'Admin access required.' };
  }
  if (!session.mfaVerified) {
    return { ok: false, error: 'MFA verification required.' };
  }

  const parsed = publishSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Check the message.' };

  const admin = createAdminClient();
  const { error } = await admin.rpc('admin_create_announcement', {
    p_actor_id: session.agent!.id,
    p_message: parsed.data.message,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath('/admin/announcements');
  // The banner renders from the shared app layout -- every signed-in user,
  // any role, needs to see the new announcement on their next navigation.
  revalidatePath('/', 'layout');
  return { ok: true };
}

const toggleSchema = z.object({
  announcementId: z.string().uuid(),
  active: z.boolean(),
});

export async function setAnnouncementActiveAction(
  input: z.infer<typeof toggleSchema>
): Promise<{ ok: boolean; error?: string }> {
  const session = await getSessionAgent();
  if (!session?.agent || session.agent.role !== 'admin') {
    return { ok: false, error: 'Admin access required.' };
  }
  if (!session.mfaVerified) {
    return { ok: false, error: 'MFA verification required.' };
  }

  const parsed = toggleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Check the form fields.' };

  const admin = createAdminClient();
  const { error } = await admin.rpc('admin_set_announcement_active', {
    p_actor_id: session.agent!.id,
    p_announcement_id: parsed.data.announcementId,
    p_active: parsed.data.active,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath('/admin/announcements');
  revalidatePath('/', 'layout');
  return { ok: true };
}
