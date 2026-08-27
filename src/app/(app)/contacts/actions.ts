'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requireAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { findOrCreateContact } from '@/lib/contacts';

const createContactSchema = z.object({
  fullName: z.string().min(1, 'Enter a name.').max(200),
  phone: z.string().min(1, 'Enter a phone number.').max(30),
});

/** Manual "Add contact" entry point — every other contact today only appears
 * as a side effect of logging an activity. Reuses findOrCreateContact so the
 * same phone-first/name-fallback dedup applies here too. */
export async function createContactAction(formData: FormData) {
  const parsed = createContactSchema.safeParse({
    fullName: formData.get('fullName'),
    phone: formData.get('phone') ?? '',
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

const deviceContactSchema = z.object({
  fullName: z.string().min(1).max(200),
  phone: z.string().min(1).max(30),
});
const deviceContactsSchema = z.array(deviceContactSchema).min(1).max(500);

/**
 * Bulk-import contacts picked from the device's native contact list via the
 * browser Contact Picker API (Android Chrome/Edge only — the client
 * component feature-detects and never renders its trigger elsewhere). Same
 * phone-first dedup as every other contact-creation path, just looped.
 */
export async function importDeviceContactsAction(
  contacts: { fullName: string; phone: string }[]
): Promise<{ ok: true; imported: number; failed: number } | { ok: false; error: string }> {
  const parsed = deviceContactsSchema.safeParse(contacts);
  if (!parsed.success) return { ok: false, error: 'No contacts to import.' };

  const session = await requireAgent();
  const supabase = await createClient();

  // Same rate-limit scope/budget as the Excel importer (04-security.md) —
  // this is the same kind of bulk-write action, just a different source.
  const { data: withinLimit } = await supabase.rpc('check_rate_limit', {
    p_scope: 'import',
    p_limit: 5,
    p_window_seconds: 3600,
  });
  if (withinLimit === false) {
    return { ok: false, error: 'Too many imports too quickly — try again in a bit.' };
  }

  let imported = 0;
  let failed = 0;
  for (const c of parsed.data) {
    const result = await findOrCreateContact(
      supabase,
      session.agent!.id,
      session.agent!.org_id,
      c.fullName,
      null,
      c.phone
    );
    if ('error' in result) failed += 1;
    else imported += 1;
  }

  revalidatePath('/contacts');
  return { ok: true, imported, failed };
}
