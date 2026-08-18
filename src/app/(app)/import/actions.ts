'use server';

import { requireAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { parseWorkbook, type ParseResult } from '@/lib/import/parse-workbook';
import { commitImport, type CommitResult } from '@/lib/import/commit-import';

export async function parseWorkbookAction(
  formData: FormData
): Promise<{ ok: true; result: ParseResult } | { ok: false; error: string }> {
  await requireAgent();

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'Choose a .xlsx file to import.' };
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const result = parseWorkbook(buffer);
    return { ok: true, result };
  } catch {
    return { ok: false, error: 'Could not read that file. Is it a valid .xlsx workbook?' };
  }
}

export async function commitImportAction(
  parseResult: ParseResult
): Promise<{ ok: true; result: CommitResult } | { ok: false; error: string }> {
  const session = await requireAgent();
  const supabase = await createClient();

  const result = await commitImport(supabase, session.agent!.id, session.agent!.org_id, parseResult.rows);
  return { ok: true, result };
}
