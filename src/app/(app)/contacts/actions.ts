'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { findOrCreateContact } from '@/lib/contacts';
import { E164, optionalPhoneSchema } from '@/lib/phone';

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

const deviceContactSchema = z.object({
  fullName: z.string().min(1).max(200),
  // Already normalised by the client (phoneFromDevice); re-checked here.
  phoneNumber: z.string().regex(E164).nullable().optional(),
});
// A phone's full contact list can easily run into the thousands; the old
// 500 cap rejected the whole import outright above that (see below for why
// that's now safe to lift).
const deviceContactsSchema = z.array(deviceContactSchema).min(1).max(5000);

const INSERT_CHUNK_SIZE = 200;

/**
 * Bulk-import contacts picked from the device's native contact list via the
 * browser Contact Picker API (Android Chrome/Edge only — the client
 * component feature-detects and never renders its trigger elsewhere).
 * Name and, since P33, the contact's first phone number (when the agent
 * picks one; E.164, see lib/phone.ts). Contacts still match on name only. A
 * contact that already exists gets the picked number only if it has none --
 * an import never overwrites a number the agent already has.
 *
 * Deliberately NOT a loop of findOrCreateContact() calls: that issues
 * sequential network round-trips per contact (name lookup, insert), which
 * for a few hundred device contacts took minutes and routinely exceeded the
 * server action's execution limit -- from the user's side that reads as
 * "gets stuck and doesn't load anything." Instead this fetches the agent's
 * existing contacts once, dedupes in memory by name, and inserts everything
 * new in a handful of chunked bulk inserts.
 */
export async function importDeviceContactsAction(
  contacts: { fullName: string; phoneNumber?: string | null }[]
): Promise<{ ok: true; imported: number; failed: number } | { ok: false; error: string }> {
  const parsed = deviceContactsSchema.safeParse(contacts);
  if (!parsed.success) return { ok: false, error: 'No contacts to import.' };

  const session = await requireAgent();
  const supabase = await createClient();
  const agentId = session.agent!.id;
  const orgId = session.agent!.org_id!;

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

  const { data: existingRows } = await supabase
    .from('contacts')
    .select('id, full_name, phone_number')
    .eq('agent_id', agentId);

  const byName = new Map<string, { id: string; phone_number: string | null }>();
  for (const row of existingRows ?? []) {
    byName.set(row.full_name.toLowerCase(), row);
  }

  let imported = 0;
  let failed = 0;
  const toInsert: { agent_id: string; org_id: string; full_name: string; phone_number: string | null }[] = [];
  const phoneBackfill: { id: string; phone_number: string }[] = [];
  const seenNames = new Set<string>();

  for (const c of parsed.data) {
    const trimmed = c.fullName.trim();
    if (!trimmed) {
      failed += 1;
      continue;
    }
    const nameKey = trimmed.toLowerCase();

    const existing = byName.get(nameKey);
    if (existing) {
      if (c.phoneNumber && !existing.phone_number) {
        phoneBackfill.push({ id: existing.id, phone_number: c.phoneNumber });
        existing.phone_number = c.phoneNumber;
      }
      imported += 1;
      continue;
    }

    // De-dupe *within* this batch (two device contacts sharing a name) so we
    // don't attempt two inserts that would collide on contacts_agent_name_uq.
    if (seenNames.has(nameKey)) {
      imported += 1;
      continue;
    }
    seenNames.add(nameKey);

    toInsert.push({ agent_id: agentId, org_id: orgId, full_name: trimmed, phone_number: c.phoneNumber ?? null });
  }

  for (let i = 0; i < toInsert.length; i += INSERT_CHUNK_SIZE) {
    const chunk = toInsert.slice(i, i + INSERT_CHUNK_SIZE);
    const { data, error } = await supabase.from('contacts').insert(chunk).select('id');
    if (error) {
      console.error('importDeviceContactsAction: bulk insert failed', error);
      failed += chunk.length;
    } else {
      imported += data?.length ?? chunk.length;
    }
  }

  // Existing contacts that had no number. One update each (they're a
  // number, not a row, so no bulk upsert); the picker hands back a few
  // hundred at most and most of those are new rows above.
  for (const row of phoneBackfill) {
    await supabase
      .from('contacts')
      .update({ phone_number: row.phone_number })
      .eq('id', row.id)
      .eq('agent_id', agentId)
      .is('phone_number', null);
  }

  revalidatePath('/contacts');
  return { ok: true, imported, failed };
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
