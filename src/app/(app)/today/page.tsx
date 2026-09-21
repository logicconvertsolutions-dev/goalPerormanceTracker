import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireVerifiedAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { Phone, CalendarDays, AlertTriangle, Plus } from 'lucide-react';
import { todayIso, formatFullDisplayDate } from '@/lib/dates';
import { fetchRecentActivity } from '@/lib/recent-activity';
import { LogActivityButton } from '@/components/shell/log-activity-button';
import { SectionHeader } from './section-header';
import { KpiStat } from './kpi-stat';
import { NextUpCard } from './next-up-card';
import { TodayRow } from './today-row';
import { ActivityRow } from './activity-row';
import { QueueBand } from './queue-band';
import { fetchDueQueue } from './due-queue';
import { bandQueue, isDueNow } from './day-bands';
import type { ActivityKind } from '@/components/shell/activity-icons';

const ACTIVITY_EDIT_PATH: Record<ActivityKind, string> = {
  call: '/log',
  appointment: '/appointments',
  sale: '/sales',
  recruiting: '/recruiting',
};

export default async function TodayPage() {
  const session = await requireVerifiedAgent();
  // Admins have no personal "My Day" -- they don't log activity of their
  // own (see docs/09-account-and-auth.md). Every hardcoded post-auth
  // redirect in the app (login, magic link, MFA enrollment, terms accept,
  // feedback submit) lands here, so this is the one place that needs to
  // catch and reroute an admin session rather than every caller doing it.
  if (session.agent!.role === 'admin') redirect('/admin/agents');
  const supabase = await createClient();

  // Shared with the app shell's nav badge, memoized per request -- see
  // due-queue.ts. `asOf` is the agent's own local calendar day, not the DB
  // server's UTC current_date, so "overdue" and "due today" mean what the
  // agent would say they mean.
  const rows = await fetchDueQueue(todayIso(session.agent!.time_zone));

  // P25 D-1: the RPC now looks seven days ahead, so the queue is no longer
  // "everything that is due" -- it is "everything that is due, plus what
  // is coming". A flat list would have put next Friday's appointment in
  // the same undifferentiated run as something twelve days overdue, and
  // the Next Up card would have badged it "Due today". Banding is what
  // keeps the page honest about the widened window, which is why the two
  // land together.
  //
  // `featured` is null when nothing is actionable yet, which is what
  // preserves the "nothing due today" empty state below on a day whose
  // queue holds only future rows.
  const { featured: nextUp, bands } = bandQueue(rows, Date.now());

  const { count: callsToday } = await supabase
    .from('call_logs')
    .select('id', { count: 'exact', head: true })
    .eq('agent_id', session.agent!.id)
    .eq('call_date', todayIso(session.agent!.time_zone));

  const recentActivity = await fetchRecentActivity(supabase, session.agent!.id, 7);

  // Unchanged by the widened window: a forward-dated row has a NEGATIVE
  // days_late, so it satisfies neither predicate and cannot inflate either
  // tile. That property is the reason days_late was left free to go
  // negative rather than clamped at zero.
  const overdueCount = rows.filter((r) => r.days_late > 0).length;
  const dueTodayCount = rows.filter((r) => r.days_late === 0).length;
  const dueNowTotal = rows.filter(isDueNow).length;

  return (
    <div className="mx-auto max-w-lg space-y-7">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[34px] font-bold leading-[40px] tracking-heading-tight text-fg">
            My Day
          </h1>
          <p className="mt-0.5 text-sm text-fg-3">{formatFullDisplayDate(todayIso(session.agent!.time_zone))}</p>
        </div>
        <LogActivityButton variant="primary" size="sm" className="mt-1.5 shrink-0">
          <Plus className="h-4 w-4" aria-hidden="true" />
          Log Activity
        </LogActivityButton>
      </div>

      <div className="flex gap-2.5">
        <KpiStat icon={Phone} value={callsToday ?? 0} label="Calls logged" />
        <KpiStat icon={CalendarDays} value={dueTodayCount} label="Due today" />
        <KpiStat icon={AlertTriangle} value={overdueCount} label="Overdue" warn={overdueCount > 0} />
      </div>

      <div className="space-y-3">
        <SectionHeader
          title="Next up"
          dot
          subtitle={dueNowTotal > 0 ? `${dueNowTotal} to clear today` : 'Nothing due today'}
          action={bands.length > 0 ? { label: `View all (${rows.length})`, href: '#today-queue' } : undefined}
        />

        {/* Three distinct empty states, because they are three different
            situations and one message for all of them is how "nothing due
            today" ends up shown to someone with four appointments this
            week (10-journeys.md). */}
        {!nextUp ? (
          <div className="rounded-lg border border-line bg-panel px-4 py-4 shadow-card">
            <p className="text-sm text-fg-3">
              {rows.length === 0
                ? "Nothing due today. Set a follow-up, or log a call with an appointment set, and it'll show up here."
                : "You're clear for today — nothing left to chase. What's coming up is below."}
            </p>
          </div>
        ) : (
          <NextUpCard
            kind={nextUp.kind}
            rowId={nextUp.call_id}
            contactId={nextUp.contact_id}
            contactName={nextUp.contact_name}
            lastNote={nextUp.last_note}
            timesCalled={nextUp.times_called}
            daysLate={nextUp.days_late}
            appointmentAt={nextUp.appointment_at}
            timeZone={session.agent!.time_zone}
          />
        )}

        {bands.length > 0 && (
          <div id="today-queue" className="scroll-mt-4 space-y-3">
            {bands.map((band) => (
              <QueueBand key={band.id} id={band.id} count={band.items.length}>
                {band.items.map((row) => (
                  <TodayRow
                    key={`${row.kind}-${row.call_id}`}
                    kind={row.kind}
                    rowId={row.call_id}
                    contactId={row.contact_id}
                    contactName={row.contact_name}
                    lastNote={row.last_note}
                    timesCalled={row.times_called}
                    daysLate={row.days_late}
                    appointmentAt={row.appointment_at}
                    dueDate={row.due_date}
                    timeZone={session.agent!.time_zone}
                    overdue={row.days_late > 0}
                  />
                ))}
              </QueueBand>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <SectionHeader title="Recent activity" action={{ label: 'View all', href: '/logs' }} />
        <div className="rounded-[24px] border border-line bg-panel px-4 shadow-card">
          {recentActivity.length === 0 ? (
            <p className="py-4 text-sm text-fg-3">Nothing logged yet.</p>
          ) : (
            <div className="divide-y divide-line">
              {recentActivity.map((item) => (
                <Link
                  key={`${item.kind}-${item.id}`}
                  href={`${ACTIVITY_EDIT_PATH[item.kind]}/${item.id}/edit`}
                  className="block hover:bg-hover"
                >
                  <ActivityRow
                    kind={item.kind}
                    contactName={item.contactName}
                    summary={item.summary}
                    createdAt={item.createdAt}
                    timeZone={session.agent!.time_zone}
                  />
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
