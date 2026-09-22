import Link from 'next/link';
import { requireVerifiedAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/shell/page-header';
import { KpiCard } from '@/components/shell/kpi-card';
import { FilterBar, type FilterChip } from '@/components/shell/filter-bar';
import { isPeriodPreset, resolvePeriod, todayIso, type PeriodPreset } from '@/lib/dates';
import { noShowRateFrom, pipelineValueOpenAppts } from '@/lib/metrics';
import { AppointmentRow } from './appointment-row';
import { withReturnTo } from '@/lib/return-to';
import { UpcomingSection, type UpcomingAppointment } from './upcoming-section';

const STATUSES = ['scheduled', 'held', 'no_show', 'rescheduled', 'cancelled'] as const;

// P4: filters + summary strip (08-screen-specs.md).
export default async function AppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const session = await requireVerifiedAgent();
  const supabase = await createClient();

  const today = todayIso(session.agent!.time_zone);
  const preset: PeriodPreset = isPeriodPreset(params.period) ? params.period : 'current_cycle';
  const { from, to } = resolvePeriod(preset, today, params.from, params.to);
  const search = params.search?.trim() || '';
  const statusFilter: (typeof STATUSES)[number] | '' =
    params.status && STATUSES.includes(params.status as (typeof STATUSES)[number])
      ? (params.status as (typeof STATUSES)[number])
      : '';

  let query = supabase
    .from('appointments')
    .select('id, appt_date, appt_type, status, expected_premium_cents, referrals_given, notes, rescheduled_to_id, contacts(full_name)')
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

  // P25 C2 (F13/F5 in the screen sense): everything still pending, read
  // OUTSIDE the period filter. The table below answers "what happened in
  // this cycle", which is the wrong question for an appointment that has
  // not happened yet — with the filter on the current cycle, next week's
  // appointment was invisible on this page entirely.
  const { data: pendingRows } = await supabase
    .from('appointments')
    .select('id, appt_date, scheduled_for, appt_type, status, expected_premium_cents, contacts(full_name)')
    .eq('agent_id', session.agent!.id)
    .eq('status', 'scheduled')
    .order('appt_date', { ascending: true });

  const pending: UpcomingAppointment[] = (pendingRows ?? []).map((a) => ({
    id: a.id,
    apptDate: a.appt_date,
    scheduledFor: a.scheduled_for,
    apptType: a.appt_type,
    contactName: (a.contacts as { full_name: string } | null)?.full_name ?? '—',
  }));
  // Split on the calendar day, not the instant: an appointment at 2pm today
  // belongs under "Upcoming" all morning and is not "overdue" at 2:01.
  const overdue = pending.filter((a) => a.apptDate < today);
  const upcoming = pending.filter((a) => a.apptDate >= today);

  const held = rows.filter((r) => r.status === 'held').length;
  const noShows = rows.filter((r) => r.status === 'no_show').length;
  const cancelled = rows.filter((r) => r.status === 'cancelled').length;
  // F10: the one definition, shared with the dashboards. This used to be
  // no-shows over EVERY row in the period, which disagreed with the
  // dashboard's own formula and drifted as pending appointments resolved.
  const noShowRatePct = Math.round(
    100 * noShowRateFrom({ apptHeld: held, apptNoShow: noShows, apptCancelled: cancelled })
  );
  // Scheduled and Open premium describe what is still PENDING, so they
  // come from the same unfiltered set as the Upcoming section above them
  // and the dashboard's Open Pipeline -- not from the period's rows. A
  // tile under the Upcoming list that disagreed with it (2 vs 5) was the
  // inconsistency; so was a premium total that differed from the
  // dashboard's for the same appointments.
  const pendingCount = pendingRows?.length ?? 0;
  const openPremium = pipelineValueOpenAppts(pendingRows ?? []);

  const chips: FilterChip[] = [];
  if (search) chips.push({ key: 'search', label: `"${search}"` });
  if (statusFilter) chips.push({ key: 'status', label: statusFilter.replace('_', ' ') });

  return (
    <div className="space-y-4 max-w-3xl">
      <PageHeader
        title="Appointments"
        action={
          <Button asChild variant="primary" size="sm">
            <Link href={withReturnTo('/appointments/new', '/appointments')}>Log appointment</Link>
          </Button>
        }
      />

      <UpcomingSection overdue={overdue} upcoming={upcoming} timeZone={session.agent!.time_zone} />

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
            <KpiCard label="Scheduled" value={String(pendingCount)} hint="All pending" />
            <KpiCard label="Held" value={String(held)} />
            <KpiCard label="No-show rate" value={`${noShowRatePct}%`} hint={`${noShows} of ${held + noShows + cancelled} resolved`} />
            <KpiCard label="Open pipeline" value={`$${(openPremium / 100).toLocaleString('en-CA')}`} hint="All pending" />
          </div>

          <div className="overflow-x-auto rounded-lg border border-line shadow-card">
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
                    movedToSuccessor={a.status === 'rescheduled' && Boolean(a.rescheduled_to_id)}
                    returnTo="/appointments"
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
