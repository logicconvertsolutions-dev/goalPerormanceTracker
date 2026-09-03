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

export default async function TodayPage() {
  const session = await requireVerifiedAgent();
  // Admins have no personal "My Day" -- they don't log activity of their
  // own (see docs/09-account-and-auth.md). Every hardcoded post-auth
  // redirect in the app (login, magic link, MFA enrollment, terms accept,
  // feedback submit) lands here, so this is the one place that needs to
  // catch and reroute an admin session rather than every caller doing it.
  if (session.agent!.role === 'admin') redirect('/admin/agents');
  const supabase = await createClient();

  // p_as_of defaults to the DB server's own current_date (UTC) when omitted
  // -- explicit here so "overdue"/"due today" reflects the agent's local
  // calendar day, not the server's.
  const { data: followUps } = await supabase.rpc('my_followups', {
    p_as_of: todayIso(session.agent!.time_zone),
  });
  // Already ordered by follow_up_on ascending (most overdue first) by the RPC.
  const rows = followUps ?? [];
  const [nextUp, ...remaining] = rows;

  const { count: callsToday } = await supabase
    .from('call_logs')
    .select('id', { count: 'exact', head: true })
    .eq('agent_id', session.agent!.id)
    .eq('call_date', todayIso(session.agent!.time_zone));

  const recentActivity = await fetchRecentActivity(supabase, session.agent!.id, 7);

  const overdueCount = rows.filter((r) => r.days_late > 0).length;
  const dueTodayCount = rows.filter((r) => r.days_late === 0).length;

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
          subtitle="Due today"
          action={remaining.length > 0 ? { label: `View all (${rows.length})`, href: '#today-queue' } : undefined}
        />

        {!nextUp ? (
          <div className="rounded-lg border border-line bg-panel px-4 py-4 shadow-card">
            <p className="text-sm text-fg-3">
              Nothing due today. Set a follow-up when you log a call and it&apos;ll show up here.
            </p>
          </div>
        ) : (
          <>
            <NextUpCard
              callLogId={nextUp.call_id}
              contactId={nextUp.contact_id}
              contactName={nextUp.contact_name}
              lastNote={nextUp.last_note}
              timesCalled={nextUp.times_called}
              daysLate={nextUp.days_late}
            />

            {remaining.length > 0 && (
              <div
                id="today-queue"
                className="scroll-mt-4 divide-y divide-line rounded-lg border border-line bg-panel px-4 shadow-card"
              >
                {remaining.map((row) => (
                  <TodayRow
                    key={row.call_id}
                    callLogId={row.call_id}
                    contactId={row.contact_id}
                    contactName={row.contact_name}
                    lastNote={row.last_note}
                    timesCalled={row.times_called}
                    daysLate={row.days_late}
                    overdue={row.days_late > 0}
                  />
                ))}
              </div>
            )}
          </>
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
                <ActivityRow
                  key={`${item.kind}-${item.id}`}
                  kind={item.kind}
                  contactName={item.contactName}
                  summary={item.summary}
                  createdAt={item.createdAt}
                  timeZone={session.agent!.time_zone}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
