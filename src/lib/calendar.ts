import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../types/database';
import { addDays, isoToDateInZone, zonedDateTimeToIso } from './dates';

export type CalendarItemKind = 'appointment' | 'follow_up' | 'todo' | 'reminder';

export interface CalendarItem {
  id: string;
  kind: CalendarItemKind;
  title: string;
  subtitle: string | null;
  /** Agent-local calendar date, YYYY-MM-DD. */
  date: string;
  /** Instant it starts, when it has a time; null = all-day. */
  startsAt: string | null;
  done: boolean;
  href: string | null;
}

/**
 * Everything the My Day calendar shows for an inclusive agent-local date
 * range: appointments, open call follow-ups, to-dos and reminders. Only ever
 * the signed-in agent's OWN rows (RLS enforces it; the agent_id filters just
 * keep the queries index-friendly). This lists individual items for the
 * agent's own planner -- it is not a metric, so it does not go through
 * daily_metrics (CLAUDE.md rule 10 covers dashboard aggregates).
 */
export async function fetchCalendarItems(
  supabase: SupabaseClient<Database>,
  agentId: string,
  timeZone: string | null,
  from: string,
  to: string
): Promise<CalendarItem[]> {
  const startIso = zonedDateTimeToIso(from, '00:00', timeZone);
  const endIso = zonedDateTimeToIso(addDays(to, 1), '00:00', timeZone);

  const [{ data: appts }, { data: followUps }, { data: tasks }, { data: reminders }] = await Promise.all([
    supabase
      .from('appointments')
      .select('id, scheduled_for, appt_date, status, appt_type, contacts(full_name)')
      .eq('agent_id', agentId)
      .neq('status', 'rescheduled')
      .or(
        `and(scheduled_for.gte.${startIso},scheduled_for.lt.${endIso}),` +
          `and(scheduled_for.is.null,appt_date.gte.${from},appt_date.lte.${to})`
      ),
    supabase
      .from('call_logs')
      .select('id, follow_up_on, contacts(full_name)')
      .eq('agent_id', agentId)
      .is('follow_up_done_at', null)
      .gte('follow_up_on', from)
      .lte('follow_up_on', to),
    supabase
      .from('tasks')
      .select('id, title, kind, due_on, due_at, done_at')
      .eq('agent_id', agentId)
      .gte('due_on', from)
      .lte('due_on', to),
    supabase
      .from('reminders')
      .select('id, title, remind_at')
      .eq('agent_id', agentId)
      .is('dismissed_at', null)
      .gte('remind_at', startIso)
      .lt('remind_at', endIso),
  ]);

  const name = (c: unknown) => (c as { full_name: string } | null)?.full_name ?? 'Contact';

  const items: CalendarItem[] = [
    ...(appts ?? []).map((a) => ({
      id: a.id,
      kind: 'appointment' as const,
      title: name(a.contacts),
      subtitle: a.status === 'scheduled' ? 'Appointment' : `Appointment · ${a.status.replace('_', ' ')}`,
      date: a.scheduled_for ? isoToDateInZone(a.scheduled_for, timeZone) : a.appt_date,
      startsAt: a.scheduled_for,
      done: a.status !== 'scheduled',
      href: `/appointments/${a.id}/edit`,
    })),
    ...(followUps ?? []).map((f) => ({
      id: f.id,
      kind: 'follow_up' as const,
      title: name(f.contacts),
      subtitle: 'Follow-up call',
      date: f.follow_up_on!,
      startsAt: null,
      done: false,
      href: '/today/due',
    })),
    ...(tasks ?? []).map((t) => ({
      id: t.id,
      kind: 'todo' as const,
      title: t.title,
      subtitle: 'To do',
      date: t.due_on,
      startsAt: t.due_at,
      done: t.done_at !== null,
      href: null,
    })),
    ...(reminders ?? []).map((r) => ({
      id: r.id,
      kind: 'reminder' as const,
      title: r.title,
      subtitle: 'Reminder',
      date: isoToDateInZone(r.remind_at, timeZone),
      startsAt: r.remind_at,
      done: false,
      href: null,
    })),
  ];

  // All-day items first within a day, then by start time.
  items.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (!a.startsAt || !b.startsAt) return a.startsAt ? 1 : b.startsAt ? -1 : 0;
    return a.startsAt < b.startsAt ? -1 : 1;
  });
  return items;
}
