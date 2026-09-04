'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { findOrCreateContact } from '@/lib/contacts';

const createContactSchema = z.object({
  fullName: z.string().min(1, 'Enter a name.').max(200),
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
    parsed.data.notes
  );
  if ('error' in contact) return { ok: false, error: contact.error };

  revalidatePath('/contacts');
  return { ok: true, id: contact.id };
}

const deviceContactSchema = z.object({
  fullName: z.string().min(1).max(200),
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
 * Only the name is imported — phone numbers are never requested from the
 * picker, stored, or matched on.
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
  contacts: { fullName: string }[]
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
    .select('id, full_name')
    .eq('agent_id', agentId);

  const byName = new Map<string, { id: string }>();
  for (const row of existingRows ?? []) {
    byName.set(row.full_name.toLowerCase(), row);
  }

  let imported = 0;
  let failed = 0;
  const toInsert: { agent_id: string; org_id: string; full_name: string }[] = [];
  const seenNames = new Set<string>();

  for (const c of parsed.data) {
    const trimmed = c.fullName.trim();
    if (!trimmed) {
      failed += 1;
      continue;
    }
    const nameKey = trimmed.toLowerCase();

    if (byName.has(nameKey)) {
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

    toInsert.push({ agent_id: agentId, org_id: orgId, full_name: trimmed });
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
