import Link from 'next/link';
import { requireVerifiedAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/shell/page-header';
import { KpiCard } from '@/components/shell/kpi-card';
import { FilterBar, type FilterChip } from '@/components/shell/filter-bar';
import { resolvePeriod, todayIso, type PeriodPreset, PERIOD_PRESETS } from '@/lib/dates';
import { AppointmentRow } from './appointment-row';

const STATUSES = ['scheduled', 'held', 'no_show', 'rescheduled', 'cancelled'] as const;

function isPeriodPreset(v: string | undefined): v is PeriodPreset {
  return !!v && (PERIOD_PRESETS as readonly string[]).includes(v);
}

// P4: filters + summary strip (08-screen-specs.md).
export default async function AppointmentsPage({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>;
}) {
  const params = searchParams;
  const session = await requireVerifiedAgent();
  const supabase = await createClient();

  const today = todayIso();
  const preset: PeriodPreset = isPeriodPreset(params.period) ? params.period : 'this_week';
  const { from, to } = resolvePeriod(preset, today, params.from, params.to);
  const search = params.search?.trim() || '';
  const statusFilter: (typeof STATUSES)[number] | '' =
    params.status && STATUSES.includes(params.status as (typeof STATUSES)[number])
      ? (params.status as (typeof STATUSES)[number])
      : '';

  let query = supabase
    .from('appointments')
    .select('id, appt_date, appt_type, status, expected_premium_cents, referrals_given, notes, contacts(full_name)')
    .eq('agent_id', session.agent!.id)
    .gte('appt_date', from)
    .lte('appt_date', to);

  if (statusFilter) query = query.eq('status', statusFilter);

  if (search) {
    const { data: matches } = await supabase
      .from('contacts')
      .select('id')
      .eq('agent_id', session.agent!.id)
      .filter('full_name', 'ilike', `%${search.replace(/[%_]/g, '\\$&')}%`);
    const contactIds = (matches ?? []).map((c) => c.id);
    query = query.in('contact_id', contactIds.length ? contactIds : ['00000000-0000-0000-0000-000000000000']);
  }

  const { data: appointments } = await query.order('appt_date', { ascending: false });
  const rows = appointments ?? [];

  const held = rows.filter((r) => r.status === 'held').length;
  const noShows = rows.filter((r) => r.status === 'no_show').length;
  const scheduled = rows.filter((r) => r.status === 'scheduled');
  const statusesLogged = rows.length;
  const noShowRatePct = statusesLogged === 0 ? 0 : Math.round((100 * noShows) / statusesLogged);
  const openPremium = scheduled.reduce((acc, r) => acc + r.expected_premium_cents, 0);

  const chips: FilterChip[] = [];
  if (search) chips.push({ key: 'search', label: `"${search}"` });
  if (statusFilter) chips.push({ key: 'status', label: statusFilter.replace('_', ' ') });

  return (
    <div className="space-y-4 max-w-3xl">
      <PageHeader
        title="Appointments"
        action={
          <Button asChild variant="primary" size="sm">
            <Link href="/appointments/new">Log appointment</Link>
          </Button>
        }
      />

      <FilterBar preset={preset} customFrom={params.from} customTo={params.to} chips={chips}>
        <form action="/appointments" className="flex items-center gap-2">
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
                {s.replace('_', ' ')}
              </option>
            ))}
          </select>
          <Input
            type="search"
            name="search"
            defaultValue={search}
            placeholder="Search contact…"
            className="h-9 w-40"
            aria-label="Search contact"
          />
        </form>
      </FilterBar>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-fg-2">
              No appointments between {from} and {to} with these filters.{' '}
              <Link href="/appointments" className="text-acc hover:underline">
                Clear all
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard label="Scheduled" value={String(scheduled.length)} />
            <KpiCard label="Held" value={String(held)} />
            <KpiCard label="No-show rate" value={`${noShowRatePct}%`} />
            <KpiCard label="Open premium" value={`$${(openPremium / 100).toLocaleString('en-CA')}`} />
          </div>

          <div className="overflow-x-auto rounded-[12px] border border-line shadow-card">
            <table className="w-full text-sm">
              <thead className="bg-bg-2 text-fg-3 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left font-medium px-4 py-2.5">Date</th>
                  <th className="text-left font-medium px-4 py-2.5">Contact</th>
                  <th className="text-left font-medium px-4 py-2.5">Type</th>
                  <th className="text-left font-medium px-4 py-2.5">Status</th>
                  <th className="text-left font-medium px-4 py-2.5">Expected premium</th>
                  <th className="text-left font-medium px-4 py-2.5">Referrals</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <AppointmentRow
                    key={a.id}
                    id={a.id}
                    apptDate={a.appt_date}
                    apptType={a.appt_type}
                    status={a.status}
                    expectedPremiumCents={a.expected_premium_cents}
                    referralsGiven={a.referrals_given}
                    contactName={(a.contacts as { full_name: string } | null)?.full_name ?? '—'}
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
