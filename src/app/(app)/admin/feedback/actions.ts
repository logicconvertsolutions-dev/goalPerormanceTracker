'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';

const updateSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['new', 'reviewed', 'resolved']),
});

export async function updateFeedbackStatusAction(input: z.infer<typeof updateSchema>) {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid request' };

  await requireAdmin();
  const supabase = await createClient();

  // feedback_admin_update (p10b) + `grant update (status)` are what actually
  // authorize this -- the RLS/column-grant pair is the real gate, this
  // requireAdmin() call just gives a clean redirect instead of a raw error.
  const { error } = await supabase
    .from('feedback')
    .update({ status: parsed.data.status })
    .eq('id', parsed.data.id);

  revalidatePath('/admin/feedback');
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
