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

  // 04-security.md: rate limit the import path. Spreadsheet imports are an
  // occasional, deliberate action, not a per-tap flow -- a handful per hour
  // is generous for legitimate re-imports and corrections.
  const { data: withinLimit } = await supabase.rpc('check_rate_limit', {
    p_scope: 'import',
    p_limit: 5,
    p_window_seconds: 3600,
  });
  if (withinLimit === false) {
    return { ok: false, error: 'Too many imports too quickly — try again in a bit.' };
  }

  const result = await commitImport(supabase, session.agent!.id, session.agent!.org_id, parseResult.rows);
  return { ok: true, result };
}
