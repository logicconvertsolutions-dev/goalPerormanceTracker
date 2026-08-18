'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

const nameSchema = z.object({ fullName: z.string().min(1).max(200) });

export async function updateFullNameAction(formData: FormData) {
  const parsed = nameSchema.safeParse({ fullName: formData.get('fullName') });
  if (!parsed.success) return { ok: false, error: 'Enter a name.' };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in.' };

  // Grants on agents restrict authenticated UPDATE to the full_name column
  // only (p1h_rls_policies.sql) — any other field in this call would be
  // rejected by the guard trigger, so this is safe as a direct table write.
  const { error } = await supabase
    .from('agents')
    .update({ full_name: parsed.data.fullName })
    .eq('id', user.id);

  revalidatePath('/profile');
  return { ok: !error };
}

const passwordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

export async function changePasswordAction(input: z.infer<typeof passwordSchema>) {
  const parsed = passwordSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid input.' };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return { ok: false, error: 'Not signed in.' };

  // Re-verify the current password before allowing a change.
  const { error: reauthError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: parsed.data.currentPassword,
  });
  if (reauthError) return { ok: false, error: 'Current password is incorrect.' };

  const { error } = await supabase.auth.updateUser({
    password: parsed.data.newPassword,
  });
  return { ok: !error, error: error?.message };
}

export async function signOutEverywhereAction() {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: 'global' });
}
