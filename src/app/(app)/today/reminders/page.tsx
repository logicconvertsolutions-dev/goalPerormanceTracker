import { redirect } from 'next/navigation';
import { requireVerifiedAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { todayIso, zonedDateTimeToIso } from '@/lib/dates';
import { NewReminderButton, ReminderList, type ReminderItem } from '../reminder-list';
import { PlannerPageHeader } from '../planner-page-header';

const FILTERS = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'done', label: 'Done' },
] as const;
type Filter = (typeof FILTERS)[number]['key'];

const MAX_ROWS = 500;

/**
 * Every reminder (P31) -- the My Day card's "View all". Upcoming: not
 * completed, from today on, soonest first. Done: completed ones plus any
 * past reminder, newest first. Tap a row to edit; editing a done reminder
 * brings it back as upcoming.
 */
export default async function RemindersPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const session = await requireVerifiedAgent();
  if (session.agent!.role === 'admin') redirect('/admin/agents');
  const supabase = await createClient();
  const agentId = session.agent!.id;
  const timeZone = session.agent!.time_zone;
  const today = todayIso(timeZone);
  const startOfToday = zonedDateTimeToIso(today, '00:00', timeZone);
  const params = await searchParams;
  const filter: Filter = FILTERS.some((f) => f.key === params.status) ? (params.status as Filter) : 'upcoming';

  const doneOr = `dismissed_at.not.is.null,remind_at.lt.${startOfToday}`;
  const columns = 'id, title, remind_at, lead_minutes, push, sent_at, dismissed_at';

  const [{ data }, { count: upcoming }, { count: done }] = await Promise.all([
    filter === 'upcoming'
      ? supabase
          .from('reminders')
          .select(columns)
          .eq('agent_id', agentId)
          .is('dismissed_at', null)
          .gte('remind_at', startOfToday)
          .order('remind_at', { ascending: true })
          .limit(MAX_ROWS)
      : supabase
          .from('reminders')
          .select(columns)
          .eq('agent_id', agentId)
          .or(doneOr)
          .order('remind_at', { ascending: false })
          .limit(MAX_ROWS),
    supabase
      .from('reminders')
      .select('id', { count: 'exact', head: true })
      .eq('agent_id', agentId)
      .is('dismissed_at', null)
      .gte('remind_at', startOfToday),
    supabase.from('reminders').select('id', { count: 'exact', head: true }).eq('agent_id', agentId).or(doneOr),
  ]);
  const reminders: ReminderItem[] = data ?? [];
  const counts: Record<Filter, number> = { upcoming: upcoming ?? 0, done: done ?? 0 };

  return (
    <div className="mx-auto max-w-lg space-y-4 lg:max-w-2xl">
      <PlannerPageHeader
        title="Reminders"
        label="Filter reminders"
        current={filter}
        filters={FILTERS.map((f) => ({
          key: f.key,
          label: f.label,
          href: `/today/reminders?status=${f.key}`,
          count: counts[f.key],
        }))}
      />

      <section className="rounded-lg border border-line bg-panel p-4 shadow-card">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-bold text-fg">{filter === 'upcoming' ? 'Coming up' : 'Completed and past'}</p>
          <NewReminderButton today={today} timeZone={timeZone} />
        </div>
        {reminders.length === 0 ? (
          <p className="text-sm text-fg-3">
            {filter === 'upcoming' ? 'No upcoming reminders. Tap “New” to add one.' : 'Nothing here yet.'}
          </p>
        ) : (
          <ReminderList reminders={reminders} today={today} timeZone={timeZone} allowDelete />
        )}
      </section>
    </div>
  );
}
