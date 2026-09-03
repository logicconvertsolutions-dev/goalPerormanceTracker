'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { findOrCreateContact, normalizePhone } from '@/lib/contacts';

const createContactSchema = z.object({
  fullName: z.string().min(1, 'Enter a name.').max(200),
  // Phone is optional (compliance: we don't require collecting it) — an
  // empty string from the form is normalized to undefined so it doesn't
  // get stored as ''.
  phone: z
    .string()
    .max(30)
    .optional()
    .transform((v) => (v?.trim() ? v.trim() : undefined)),
});

/** Manual "Add contact" entry point — every other contact today only appears
 * as a side effect of logging an activity. Reuses findOrCreateContact so the
 * same name-first/phone-fallback dedup applies here too. */
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
    session.agent!.org_id!,
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
  phone: z.string().max(30).optional(),
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
 *
 * Deliberately NOT a loop of findOrCreateContact() calls: that issues up to
 * 3 sequential network round-trips per contact (phone lookup, name lookup,
 * insert), which for a few hundred device contacts took minutes and
 * routinely exceeded the server action's execution limit -- from the user's
 * side that reads as "gets stuck and doesn't load anything." Instead this
 * fetches the agent's existing contacts once, dedupes in memory (same
 * name-first-then-phone-fallback rule as findOrCreateContact), and inserts
 * everything new in a handful of chunked bulk inserts.
 */
export async function importDeviceContactsAction(
  contacts: { fullName: string; phone?: string }[]
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
    .select('id, full_name, phone, phone_normalized')
    .eq('agent_id', agentId);

  const byPhone = new Map<string, { id: string; phone: string | null }>();
  const byName = new Map<string, { id: string; phone: string | null }>();
  for (const row of existingRows ?? []) {
    if (row.phone_normalized) byPhone.set(row.phone_normalized, row);
    byName.set(row.full_name.toLowerCase(), row);
  }

  let imported = 0;
  let failed = 0;
  const backfills: { id: string; phone: string }[] = [];
  const toInsert: { agent_id: string; org_id: string; full_name: string; phone: string | null }[] = [];
  const seenPhones = new Set<string>();
  const seenNames = new Set<string>();

  for (const c of parsed.data) {
    const trimmed = c.fullName.trim();
    if (!trimmed) {
      failed += 1;
      continue;
    }
    const normalizedPhone = normalizePhone(c.phone);
    const nameKey = trimmed.toLowerCase();
    // Name first -- it's the only identifier guaranteed to exist now that
    // phone is optional. Phone is only a fallback signal for a name match miss.
    const existing = byName.get(nameKey) || (normalizedPhone ? byPhone.get(normalizedPhone) : undefined);

    if (existing) {
      imported += 1;
      if (normalizedPhone && !existing.phone) {
        backfills.push({ id: existing.id, phone: c.phone! });
        existing.phone = c.phone!; // so a later dup in this same batch also sees it filled
      }
      continue;
    }

    // De-dupe *within* this batch (two device contacts sharing a name or
    // phone) so we don't attempt two inserts that would collide on the
    // contacts_agent_name_uq/contacts_agent_phone_uq unique indexes.
    if (seenNames.has(nameKey) || (normalizedPhone && seenPhones.has(normalizedPhone))) {
      imported += 1;
      continue;
    }
    seenNames.add(nameKey);
    if (normalizedPhone) seenPhones.add(normalizedPhone);

    toInsert.push({ agent_id: agentId, org_id: orgId, full_name: trimmed, phone: c.phone || null });
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

  if (backfills.length > 0) {
    await Promise.all(backfills.map((b) => supabase.from('contacts').update({ phone: b.phone }).eq('id', b.id)));
  }

  revalidatePath('/contacts');
  return { ok: true, imported, failed };
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
