'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requireAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { findOrCreateContact } from '@/lib/contacts';

const createContactSchema = z.object({
  fullName: z.string().min(1, 'Enter a name.').max(200),
  phone: z.string().max(30).optional(),
});

/** Manual "Add contact" entry point — every other contact today only appears
 * as a side effect of logging an activity. Reuses findOrCreateContact so the
 * same phone-first/name-fallback dedup applies here too. */
export async function createContactAction(formData: FormData) {
  const parsed = createContactSchema.safeParse({
    fullName: formData.get('fullName'),
    phone: formData.get('phone') || undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }

  const session = await requireAgent();
  const supabase = await createClient();

  const contact = await findOrCreateContact(
    supabase,
    session.agent!.id,
    session.agent!.org_id,
    parsed.data.fullName,
    null,
    parsed.data.phone
  );
  if ('error' in contact) return { ok: false, error: contact.error };

  revalidatePath('/contacts');
  return { ok: true, id: contact.id };
}
