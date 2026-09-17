import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { FilterBar } from '@/components/shell/filter-bar';
import { isPeriodPreset, resolvePeriod, todayIso, type PeriodPreset } from '@/lib/dates';
import {
  REPORT_TYPE_LIST,
  REPORT_TYPES,
  isReportTypeId,
  resolveColumns,
  formatCell,
  type ReportTypeId,
} from '@/lib/reports/report-types';
import { fetchReportRows } from '@/lib/reports/fetch-report';
import type { ReportDefinitionsClient } from '@/lib/reports/report-definitions-client';
import { ReportControls } from './report-controls';
import { SaveReportDialog } from './save-report-dialog';
import { DeleteReportButton } from './delete-report-button';

export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<{
    type?: string;
    org?: string;
    period?: string;
    from?: string;
    to?: string;
    cols?: string;
  }>;
}) {
  const session = await requireAdmin();
  const supabase = await createClient();
  const admin = createAdminClient();

  const params = await searchParams;
  const type: ReportTypeId = isReportTypeId(params.type) ? params.type : 'agent_roster';
  const config = REPORT_TYPES[type];
  const orgId = params.org ?? null;
  const selectedColumns = params.cols ? params.cols.split(',').filter(Boolean) : config.defaultColumns;

  const today = todayIso(session.agent!.time_zone);
  const preset: PeriodPreset = isPeriodPreset(params.period) ? params.period : 'current_cycle';
  const { from, to } = resolvePeriod(preset, today, params.from, params.to);

  const [{ data: orgs }, rows, { data: savedReports }] = await Promise.all([
    supabase.from('organizations').select('id, name').order('name'),
    fetchReportRows(supabase, admin, { type, orgId, from, to }),
    (admin as unknown as ReportDefinitionsClient)
      .from('report_definitions')
      .select('id, created_by, report_type, name, filters, columns, created_at')
      .order('created_at', { ascending: false }),
  ]);

  const columns = resolveColumns(type, selectedColumns);
  const orgList = orgs ?? [];

  const exportParams = new URLSearchParams({ type, cols: selectedColumns.join(',') });
  if (orgId) exportParams.set('org', orgId);
  if (config.needsDateRange) {
    exportParams.set('from', from);
    exportParams.set('to', to);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-heading-tight text-fg">Reports</h1>
        <SaveReportDialog reportType={type} columns={selectedColumns} />
      </div>

      <div className="flex w-fit flex-wrap gap-1 rounded-sm border border-line-2 bg-sunken p-1">
        {REPORT_TYPE_LIST.map((rt) => (
          <Link
            key={rt.id}
            href={`?type=${rt.id}`}
            className={
              rt.id === type
                ? 'inline-flex min-h-[32px] items-center rounded-sm bg-acc px-3 py-1.5 text-xs font-medium text-bg'
                : 'inline-flex min-h-[32px] items-center rounded-sm px-3 py-1.5 text-xs font-medium text-fg-2 hover:bg-hover hover:text-fg'
            }
          >
            {rt.label}
          </Link>
        ))}
      </div>
      <p className="text-sm text-fg-3">{config.description}</p>

      {(savedReports ?? []).length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-fg-3">
          <span>Saved:</span>
          {(savedReports ?? []).map((r) => {
            const f = r.filters ?? {};
            const qp = new URLSearchParams({ type: r.report_type });
            if (f.org) qp.set('org', f.org);
            if (f.period) qp.set('period', f.period);
            if (f.from) qp.set('from', f.from);
            if (f.to) qp.set('to', f.to);
            if (r.columns && r.columns.length > 0) qp.set('cols', r.columns.join(','));
            return (
              <span
                key={r.id}
                className="inline-flex items-center gap-1 rounded-full border border-line-2 bg-panel-2 px-2.5 py-1"
              >
                <Link href={`?${qp.toString()}`} className="hover:underline">
                  {r.name}
                </Link>
                <DeleteReportButton id={r.id} name={r.name} />
              </span>
            );
          })}
        </div>
      )}

      {config.needsDateRange ? (
        <FilterBar preset={preset} customFrom={params.from} customTo={params.to}>
          <ReportControls
            orgs={orgList}
            currentOrgId={orgId}
            columns={config.columns}
            selectedColumns={selectedColumns}
          />
        </FilterBar>
      ) : (
        <ReportControls
          orgs={orgList}
          currentOrgId={orgId}
          columns={config.columns}
          selectedColumns={selectedColumns}
        />
      )}

      <div className="text-right">
        <Link href={`/admin/reports/export?${exportParams.toString()}`} className="text-xs text-acc hover:underline">
          Export CSV
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-fg-3">No data matches these filters.</p>
      ) : (
        <>
          {/* Mobile: a divided list, same visual language as Contacts/Agents. */}
          <div className="divide-y divide-line rounded-lg border border-line bg-panel px-4 shadow-card md:hidden">
            {rows.map((row, i) => (
              <div key={i} className="space-y-1 py-3 text-sm">
                {columns.map((col) => (
                  <p key={col.key} className="text-fg-2">
                    <span className="text-fg-3">{col.label}: </span>
                    {formatCell(row[col.key], col.format)}
                  </p>
                ))}
              </div>
            ))}
          </div>

          {/* Desktop / tablet: full table. */}
          <div className="hidden overflow-x-auto rounded-lg border border-line shadow-card md:block">
            <table className="w-full text-sm">
              <thead className="bg-bg-2 text-fg-3 text-xs uppercase tracking-wide">
                <tr>
                  {columns.map((col) => (
                    <th key={col.key} className="px-4 py-2.5 text-left font-medium">
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} className="border-t border-line hover:bg-hover">
                    {columns.map((col) => (
                      <td key={col.key} className="px-4 py-2.5 text-fg-2">
                        {formatCell(row[col.key], col.format)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
