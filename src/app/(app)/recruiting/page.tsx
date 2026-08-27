import Link from 'next/link';
import { requireVerifiedAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/shell/page-header';
import { KpiCard } from '@/components/shell/kpi-card';
import { FilterBar, type FilterChip } from '@/components/shell/filter-bar';
import { resolvePeriod, todayIso, type PeriodPreset, PERIOD_PRESETS } from '@/lib/dates';
import { RecruitingRow } from './recruiting-row';

const STATUSES = [
  'contacted',
  'marketing_presented',
  'recruited',
  'certified',
  'licensed',
  'declined',
] as const;

function isPeriodPreset(v: string | undefined): v is PeriodPreset {
  return !!v && (PERIOD_PRESETS as readonly string[]).includes(v);
}

// P4: filters + summary strip (08-screen-specs.md).
export default async function RecruitingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const session = await requireVerifiedAgent();
  const supabase = await createClient();

  const today = todayIso();
  const preset: PeriodPreset = isPeriodPreset(params.period) ? params.period : 'this_week';
  const { from, to } = resolvePeriod(preset, today, params.from, params.to);
  const statusFilter: (typeof STATUSES)[number] | '' =
    params.status && STATUSES.includes(params.status as (typeof STATUSES)[number])
      ? (params.status as (typeof STATUSES)[number])
      : '';

  let query = supabase
    .from('recruiting_logs')
    .select('id, log_date, source, status, contacts(full_name)')
    .eq('agent_id', session.agent!.id)
    .gte('log_date', from)
    .lte('log_date', to);

  if (statusFilter) query = query.eq('status', statusFilter);

  const { data: logs } = await query.order('log_date', { ascending: false });
  const rows = logs ?? [];

  const conversations = rows.length;
  const marketingPresented = rows.filter((r) =>
    ['marketing_presented', 'recruited', 'certified', 'licensed'].includes(r.status)
  ).length;
  const recruited = rows.filter((r) => ['recruited', 'certified', 'licensed'].includes(r.status)).length;
  const licensed = rows.filter((r) => r.status === 'licensed').length;

  const chips: FilterChip[] = [];
  if (statusFilter) chips.push({ key: 'status', label: statusFilter });

  return (
    <div className="space-y-4 max-w-3xl">
      <PageHeader
        title="Recruiting"
        action={
          <Button asChild variant="primary" size="sm">
            <Link href="/recruiting/new">Log conversation</Link>
          </Button>
        }
      />

      <FilterBar preset={preset} customFrom={params.from} customTo={params.to} chips={chips}>
        <form action="/recruiting" className="flex items-center gap-2">
          <input type="hidden" name="period" value={preset} />
          {params.from && <input type="hidden" name="from" value={params.from} />}
          {params.to && <input type="hidden" name="to" value={params.to} />}
          <select
            name="status"
            defaultValue={statusFilter}
            className="h-9 rounded-sm border border-line-2 bg-sunken px-2 text-xs text-fg"
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </form>
      </FilterBar>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-fg-2">
              No recruiting conversations between {from} and {to} with these filters.{' '}
              <Link href="/recruiting" className="text-acc hover:underline">
                Clear all
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard label="Conversations" value={String(conversations)} />
            <KpiCard label="Marketing Presented" value={String(marketingPresented)} />
            <KpiCard label="Recruited" value={String(recruited)} />
            <KpiCard label="Licensed" value={String(licensed)} />
          </div>

          <div className="overflow-x-auto rounded-lg border border-line shadow-card">
            <table className="w-full text-sm">
              <thead className="bg-bg-2 text-fg-3 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left font-medium px-4 py-2.5">Date</th>
                  <th className="text-left font-medium px-4 py-2.5">Prospect</th>
                  <th className="text-left font-medium px-4 py-2.5">Source</th>
                  <th className="text-left font-medium px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <RecruitingRow
                    key={r.id}
                    id={r.id}
                    logDate={r.log_date}
                    prospectName={(r.contacts as { full_name: string } | null)?.full_name ?? '—'}
                    source={r.source}
                    status={r.status}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
