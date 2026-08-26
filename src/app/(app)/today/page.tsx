import { requireVerifiedAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { Phone, CalendarDays, AlertTriangle, Plus, Sparkles, ArrowRight } from 'lucide-react';
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
  const supabase = await createClient();

  const { data: followUps } = await supabase.rpc('my_followups');
  // Already ordered by follow_up_on ascending (most overdue first) by the RPC.
  const rows = followUps ?? [];
  const [nextUp, ...remaining] = rows;

  const { count: callsToday } = await supabase
    .from('call_logs')
    .select('id', { count: 'exact', head: true })
    .eq('agent_id', session.agent!.id)
    .eq('call_date', todayIso());

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
          <p className="mt-0.5 text-sm text-fg-3">{formatFullDisplayDate(todayIso())}</p>
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
          <div className="flex flex-col items-start gap-3 rounded-lg border border-line bg-panel px-4 py-4 shadow-card sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-fg-3">
              Nothing due today. Set a follow-up when you log a call and it&apos;ll show up here.
            </p>
            <LogActivityButton variant="primary" size="sm" className="shrink-0">
              Log a new call
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </LogActivityButton>
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

            {remaining.length > 0 ? (
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
            ) : (
              <div className="flex items-center gap-2 rounded-lg border border-line bg-panel px-4 py-3.5 shadow-card">
                <p className="flex items-center gap-2 text-sm text-fg-2">
                  <Sparkles className="h-4 w-4 text-gold" aria-hidden="true" />
                  All caught up after this.
                </p>
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
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
