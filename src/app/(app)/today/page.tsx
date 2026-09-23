import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireVerifiedAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { Phone, CalendarDays, AlertTriangle, Clock } from 'lucide-react';
import {
  addDays,
  calendarRange,
  formatFullDisplayDate,
  isCalendarView,
  isIsoDate,
  todayIso,
  zonedDateTimeToIso,
} from '@/lib/dates';
import { fetchRecentActivity } from '@/lib/recent-activity';
import { fetchCalendarItems } from '@/lib/calendar';
import { firstName, greetingFor } from '@/lib/greeting';
import { quoteForDate } from '@/lib/quotes';
import { SectionHeader } from './section-header';
import { KpiStat } from './kpi-stat';
import { ActivityRow } from './activity-row';
import { GreetingHero } from './greeting-hero';
import { CalendarCard } from './calendar-card';
import { TodoCard } from './todo-card';
import { RemindersCard } from './reminders-card';
import { QuoteCard } from './quote-card';
import { PageBackdrop } from './page-backdrop';
import type { ActivityKind } from '@/components/shell/activity-icons';

const ACTIVITY_EDIT_PATH: Record<ActivityKind, string> = {
  call: '/log',
  appointment: '/appointments',
  sale: '/sales',
  recruiting: '/recruiting',
};

export default async function TodayPage({ searchParams }: { searchParams: Promise<{ view?: string; date?: string }> }) {
  const session = await requireVerifiedAgent();
  // Admins have no personal "My Day" -- they don't log activity of their
  // own (see docs/09-account-and-auth.md). Every hardcoded post-auth
  // redirect in the app (login, magic link, MFA enrollment, terms accept,
  // feedback submit) lands here, so this is the one place that needs to
  // catch and reroute an admin session rather than every caller doing it.
  if (session.agent!.role === 'admin') redirect('/admin/agents');
  const supabase = await createClient();
  const agentId = session.agent!.id;
  const timeZone = session.agent!.time_zone;
  const today = todayIso(timeZone);

  // Calendar state lives in the URL (CLAUDE.md: filter state in search params).
  const params = await searchParams;
  const view = isCalendarView(params.view) ? params.view : 'day';
  const date = isIsoDate(params.date) ? params.date : today;
  const range = calendarRange(view, date);

  const [
    { data: followUps },
    { count: callsToday },
    { data: yesterday },
    recentActivity,
    calendarItems,
    { data: tasks },
    { data: reminders },
  ] = await Promise.all([
    // p_as_of: the agent's local calendar day, not the DB server's (UTC).
    supabase.rpc('my_followups', { p_as_of: today }),
    supabase
      .from('call_logs')
      .select('id', { count: 'exact', head: true })
      .eq('agent_id', agentId)
      .eq('call_date', today),
    // Yesterday comes from the read model (CLAUDE.md rule 10) -- only
    // today's own count may read call_logs directly.
    supabase
      .from('daily_metrics')
      .select('calls_made')
      .eq('agent_id', agentId)
      .eq('activity_date', addDays(today, -1))
      .maybeSingle(),
    fetchRecentActivity(supabase, agentId, 5),
    fetchCalendarItems(supabase, agentId, timeZone, range.from, range.to),
    // To Do: today's tasks, plus anything still open from earlier days.
    supabase
      .from('tasks')
      .select('id, title, kind, due_on, due_at, done_at')
      .eq('agent_id', agentId)
      .or(`due_on.eq.${today},and(due_on.lt.${today},done_at.is.null)`)
      .order('done_at', { ascending: true, nullsFirst: true })
      .order('due_on', { ascending: true })
      .order('due_at', { ascending: true, nullsFirst: false }),
    // Reminders: undismissed, from the start of today onward.
    supabase
      .from('reminders')
      .select('id, title, remind_at, lead_minutes, push, sent_at')
      .eq('agent_id', agentId)
      .is('dismissed_at', null)
      .gte('remind_at', zonedDateTimeToIso(today, '00:00', timeZone))
      .order('remind_at', { ascending: true })
      .limit(5),
  ]);

  const rows = followUps ?? [];
  const overdueCount = rows.filter((r) => r.days_late > 0).length;
  const dueTodayCount = rows.filter((r) => r.days_late === 0).length;
  const callDelta = (callsToday ?? 0) - (yesterday?.calls_made ?? 0);
  const now = new Date();

  return (
    <>
      <PageBackdrop />
      <div className="relative z-[1] mx-auto max-w-lg space-y-4 lg:max-w-6xl">
        <GreetingHero
          greeting={greetingFor(now, timeZone)}
          name={firstName(session.agent!.full_name)}
          dateLabel={formatFullDisplayDate(today)}
        />

        <div className="flex gap-2.5">
          <KpiStat
            icon={Phone}
            value={callsToday ?? 0}
            label="Calls logged"
            hint={
              callDelta === 0 ? 'Same as yesterday' : `${callDelta > 0 ? '▲' : '▼'} ${Math.abs(callDelta)} vs yesterday`
            }
          />
          <KpiStat
            icon={CalendarDays}
            value={dueTodayCount}
            label="Due today"
            href="/today/due?filter=today"
            hint="Tap to view"
          />
          <KpiStat
            icon={AlertTriangle}
            value={overdueCount}
            label="Overdue"
            warn={overdueCount > 0}
            href="/today/due?filter=overdue"
            hint="Tap to view"
          />
        </div>

        {/* Phone/tablet: one column in the order below. Desktop (lg+): two
          columns -- calendar + recent activity left, to-dos, reminders and
          the quote right. The column wrappers are display:contents below lg,
          so `order` keeps the single-column sequence without duplicating
          markup. */}
        <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-start">
          <div className="contents lg:flex lg:flex-col lg:gap-4">
            <div className="order-1 lg:order-none">
              <CalendarCard
                items={calendarItems}
                view={view}
                date={date}
                today={today}
                nowIso={now.toISOString()}
                timeZone={timeZone}
              />
            </div>
            <div className="order-4 lg:order-none">
              <div className="space-y-3">
                <SectionHeader title="Recent activity" action={{ label: 'View all', href: '/logs' }} />
                <div className="rounded-[24px] border border-line bg-panel px-4 shadow-card">
                  {recentActivity.length === 0 ? (
                    <p className="flex items-center gap-2 py-4 text-sm text-fg-3">
                      <Clock className="h-4 w-4" aria-hidden="true" />
                      Nothing logged yet.
                    </p>
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
                            status={item.status}
                            createdAt={item.createdAt}
                            timeZone={timeZone}
                          />
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
          <div className="contents lg:flex lg:flex-col lg:gap-4">
            <div className="order-2 lg:order-none">
              <TodoCard tasks={tasks ?? []} today={today} timeZone={timeZone} />
            </div>
            <div className="order-3 lg:order-none">
              <RemindersCard reminders={reminders ?? []} today={today} timeZone={timeZone} />
            </div>
            <div className="order-5 lg:order-none">
              <QuoteCard quote={quoteForDate(today)} />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
