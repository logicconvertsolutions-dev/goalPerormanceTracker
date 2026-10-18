'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { findOrCreateContact } from '@/lib/contacts';
import { E164, optionalPhoneSchema } from '@/lib/phone';
import { cleanName, cleanNotes } from '@/lib/import/parse-vcard';
import { saveContacts } from '@/lib/import/save-contacts';

const createContactSchema = z.object({
  fullName: z.string().min(1, 'Enter a name.').max(200),
  phoneNumber: optionalPhoneSchema,
  notes: z
    .string()
    .max(2000)
    .optional()
    .transform((v) => (v?.trim() ? v.trim() : undefined)),
});

/** Manual "Add contact" entry point — every other contact today only appears
 * as a side effect of logging an activity. Reuses findOrCreateContact so the
 * same name-based dedup applies here too. */
export async function createContactAction(formData: FormData) {
  const parsed = createContactSchema.safeParse({
    fullName: formData.get('fullName'),
    phoneNumber: formData.get('phoneNumber') ?? '',
    notes: formData.get('notes') ?? '',
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }

  const session = await requireAgent();
  const supabase = await createClient();

  const contact = await findOrCreateContact(
    supabase,
    session.agent!.id,
    session.agent!.org_id!,
    parsed.data.fullName,
    null,
    parsed.data.notes,
    parsed.data.phoneNumber
  );
  if ('error' in contact) return { ok: false, error: contact.error };

  // The name already existed: give it the number if it has none, but never
  // silently replace a different one.
  if (!contact.created && parsed.data.phoneNumber) {
    const { data: existing } = await supabase
      .from('contacts')
      .select('phone_number')
      .eq('id', contact.id)
      .eq('agent_id', session.agent!.id)
      .maybeSingle();
    if (existing?.phone_number && existing.phone_number !== parsed.data.phoneNumber) {
      return {
        ok: false,
        error: `You already have a contact named ${parsed.data.fullName} with a different number. Edit that contact instead.`,
      };
    }
    if (!existing?.phone_number) {
      await supabase
        .from('contacts')
        .update({ phone_number: parsed.data.phoneNumber })
        .eq('id', contact.id)
        .eq('agent_id', session.agent!.id);
    }
  }

  revalidatePath('/contacts');
  return { ok: true, id: contact.id };
}

// Lenient on purpose: one contact the server can't use costs that contact,
// never the whole import. The old strict schema (name max 200, number must be
// E.164) rejected the entire list as "No contacts to import." whenever any one
// of an agent's 1,500 phone contacts had a long name (2026-10-17). Names and
// notes are cut to size here, an unusable number is dropped, and a name that
// is empty after cleaning is counted as skipped. The raw bounds only stop
// absurd payloads; the clients already send cleaned values.
const deviceContactSchema = z.object({
  fullName: z.string().max(2000).transform(cleanName),
  phoneNumber: z
    .string()
    .max(40)
    .nullable()
    .optional()
    .transform((v) => (v && E164.test(v) ? v : null)),
  notes: z.string().max(20000).nullable().optional().transform(cleanNotes),
});
// A phone's full contact list can easily run into the thousands.
const deviceContactsSchema = z.array(deviceContactSchema).min(1).max(5000);

export type ImportContactsResult =
  | { ok: true; created: number; existing: number; failed: number; skipped: number }
  | { ok: false; error: string };

/**
 * Bulk-imports contacts from the phone's contact picker (Contact Picker API)
 * or a .vcf file (parsed in the browser, lib/import/parse-vcard.ts): name, one
 * phone number (E.164, see lib/phone.ts) and, from a .vcf, the contact's
 * notes. Matching is by name only; an existing contact only gains a number or
 * notes it doesn't have yet. All the matching and writing is in
 * saveContacts -- shared with the Excel import -- which reads every existing
 * contact (not PostgREST's first 1000) and inserts in chunks.
 */
export async function importDeviceContactsAction(
  contacts: { fullName: string; phoneNumber?: string | null; notes?: string | null }[]
): Promise<ImportContactsResult> {
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

  const usable = parsed.data.filter((c) => c.fullName);
  let saved;
  try {
    saved = await saveContacts(supabase, session.agent!.id, session.agent!.org_id!, usable);
  } catch (e) {
    console.error('importDeviceContactsAction: could not read existing contacts', e);
    return { ok: false, error: 'Could not import right now — try again.' };
  }

  revalidatePath('/contacts');
  return {
    ok: true,
    created: saved.created,
    existing: saved.existing,
    failed: saved.failed,
    skipped: parsed.data.length - usable.length,
  };
}

const updateContactSchema = z.object({
  id: z.string().uuid(),
  fullName: z.string().min(1, 'Enter a name.').max(200),
  phoneNumber: optionalPhoneSchema,
  notes: z
    .string()
    .max(2000)
    .optional()
    .transform((v) => (v?.trim() ? v.trim() : null)),
});

/** Edits a contact's own fields (name, phone, notes) -- not the activity logged
 * against them, which is edited from each log's own edit page. */
export async function updateContactAction(formData: FormData) {
  const parsed = updateContactSchema.safeParse({
    id: formData.get('id'),
    fullName: formData.get('fullName'),
    phoneNumber: formData.get('phoneNumber') ?? '',
    notes: formData.get('notes') ?? '',
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }

  const session = await requireAgent();
  const supabase = await createClient();

  const { error } = await supabase
    .from('contacts')
    .update({
      full_name: parsed.data.fullName,
      phone_number: parsed.data.phoneNumber,
      notes: parsed.data.notes,
    })
    .eq('id', parsed.data.id)
    .eq('agent_id', session.agent!.id);

  if (error) return { ok: false, error: 'Could not save — try again.' };

  revalidatePath('/contacts');
  revalidatePath(`/contacts/${parsed.data.id}`);
  return { ok: true };
}

/**
 * Deletes a contact the agent owns. `contacts_own` RLS (for all, agent_id =
 * auth.uid()) is what actually enforces ownership -- the .eq('agent_id', …)
 * below is belt-and-suspenders so a stale/tampered id fails quietly (0 rows
 * affected) instead of relying on RLS alone to notice.
 *
 * call_logs/appointments reference contact_id with `on delete cascade`, so
 * those rows are deleted along with the contact by the database itself (the
 * daily_metrics dirty-queue triggers on those tables fire for the cascaded
 * deletes too, so dashboards stay correct automatically -- see
 * 20260818132731_p1g_daily_metrics_pipeline.sql). sales/recruiting_logs
 * reference it with `on delete set null`, so those rows survive with the
 * link cleared rather than being deleted -- the confirmation dialog on the
 * client only warns about the calls/appointments that actually go away.
 */
export async function deleteContactAction(contactId: string) {
  const session = await requireAgent();
  const supabase = await createClient();

  const { error } = await supabase
    .from('contacts')
    .delete()
    .eq('id', contactId)
    .eq('agent_id', session.agent!.id);

  if (error) return { ok: false, error: 'Could not delete — try again.' };

  revalidatePath('/contacts');
  redirect('/contacts');
}
