import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isPeriodPreset, resolvePeriod, todayIso, type PeriodPreset } from '@/lib/dates';
import { REPORT_TYPES, isReportTypeId, resolveColumns, formatCell, type ReportTypeId } from '@/lib/reports/report-types';
import { fetchReportRows } from '@/lib/reports/fetch-report';

function csvField(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

// Re-runs the exact same query as the page (via the shared fetchReportRows)
// rather than exporting whatever happened to be rendered client-side, same
// reasoning as /team/export and /sales/export.
export async function GET(request: NextRequest) {
  const session = await requireAdmin();
  const supabase = await createClient();
  const admin = createAdminClient();
  const url = new URL(request.url);

  const rawType = url.searchParams.get('type');
  const type: ReportTypeId = isReportTypeId(rawType) ? rawType : 'agent_roster';
  const config = REPORT_TYPES[type];
  const orgId = url.searchParams.get('org');
  const rawCols = url.searchParams.get('cols');
  const selectedColumns = rawCols ? rawCols.split(',').filter(Boolean) : config.defaultColumns;

  const today = todayIso(session.agent!.time_zone);
  const preset: PeriodPreset = isPeriodPreset(url.searchParams.get('period'))
    ? (url.searchParams.get('period') as PeriodPreset)
    : 'current_cycle';
  const { from, to } = resolvePeriod(
    preset,
    today,
    url.searchParams.get('from') ?? undefined,
    url.searchParams.get('to') ?? undefined
  );

  const rows = await fetchReportRows(supabase, admin, { type, orgId, from, to });
  const columns = resolveColumns(type, selectedColumns);

  const header = columns.map((c) => csvField(c.label)).join(',');
  const lines = rows.map((row) =>
    columns.map((c) => csvField(formatCell(row[c.key], c.format))).join(',')
  );
  const csv = [header, ...lines].join('\r\n');

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="report-${type}-${from}-to-${to}.csv"`,
    },
  });
}
