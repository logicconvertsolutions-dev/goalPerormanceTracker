'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { getSessionAgent } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import { isReportTypeId } from '@/lib/reports/report-types';
import type { ReportDefinitionsClient } from '@/lib/reports/report-definitions-client';

const saveSchema = z.object({
  name: z.string().min(1).max(200),
  reportType: z.string(),
  filters: z.record(z.string(), z.string().optional()),
  columns: z.array(z.string()).min(1),
});

export async function saveReportDefinitionAction(
  input: z.infer<typeof saveSchema>
): Promise<{ ok: boolean; error?: string }> {
  // A Server Action needs a returned error, not a thrown redirect -- check
  // the role directly rather than requireAdmin(), same reasoning as
  // admin/orgs/actions.ts.
  const session = await getSessionAgent();
  if (!session?.agent || session.agent.role !== 'admin') {
    return { ok: false, error: 'Admin access required.' };
  }
  if (!session.mfaVerified) {
    return { ok: false, error: 'MFA verification required.' };
  }

  const parsed = saveSchema.safeParse(input);
  if (!parsed.success || !isReportTypeId(parsed.data.reportType)) {
    return { ok: false, error: 'Check the form fields.' };
  }

  const admin = createAdminClient() as unknown as ReportDefinitionsClient;
  const { error } = await admin.from('report_definitions').insert({
    created_by: session.agent!.id,
    report_type: parsed.data.reportType,
    name: parsed.data.name,
    filters: parsed.data.filters,
    columns: parsed.data.columns,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath('/admin/reports');
  return { ok: true };
}

const deleteSchema = z.object({ id: z.string().uuid() });

export async function deleteReportDefinitionAction(
  input: z.infer<typeof deleteSchema>
): Promise<{ ok: boolean; error?: string }> {
  const session = await getSessionAgent();
  if (!session?.agent || session.agent.role !== 'admin') {
    return { ok: false, error: 'Admin access required.' };
  }
  if (!session.mfaVerified) {
    return { ok: false, error: 'MFA verification required.' };
  }

  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Check the form fields.' };

  const admin = createAdminClient() as unknown as ReportDefinitionsClient;
  const { error } = await admin.from('report_definitions').delete().eq('id', parsed.data.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/admin/reports');
  return { ok: true };
}
