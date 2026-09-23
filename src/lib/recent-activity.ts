import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../types/database';
import type { ActivityKind } from '@/components/shell/activity-icons';

export type StatusTone = 'ok' | 'warn' | 'bad' | 'default' | 'neutral';

export interface RecentActivityItem {
  id: string;
  kind: ActivityKind;
  createdAt: string;
  contactName: string;
  summary: string;
  /** Outcome pill shown on the right of the row (P30). */
  status: { label: string; tone: StatusTone };
}

const CALL_STATUS: Record<string, RecentActivityItem['status']> = {
  connected: { label: 'Connected', tone: 'ok' },
  voicemail: { label: 'Voicemail', tone: 'warn' },
  no_answer: { label: 'Missed', tone: 'bad' },
  appointment_set: { label: 'Appointment', tone: 'default' },
  not_interested: { label: 'Not interested', tone: 'neutral' },
};

const APPOINTMENT_STATUS: Record<string, RecentActivityItem['status']> = {
  scheduled: { label: 'Scheduled', tone: 'default' },
  held: { label: 'Held', tone: 'ok' },
  no_show: { label: 'No-show', tone: 'bad' },
  rescheduled: { label: 'Rescheduled', tone: 'warn' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

function titleCase(v: string): string {
  const s = v.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function contactName(row: { full_name: string } | null): string {
  return row?.full_name ?? '—';
}

/**
 * The most recent activity across all four log types, newest first. Powers
 * My Day's "Recent activity" list -- fetches `limit` rows from each table
 * (cheap, index-backed on agent_id+created_at-ish order) then merges in JS
 * since there's no single table to order across all four kinds.
 */
export async function fetchRecentActivity(
  supabase: SupabaseClient<Database>,
  agentId: string,
  limit = 7
): Promise<RecentActivityItem[]> {
  const [{ data: calls }, { data: appts }, { data: sales }, { data: recruits }] = await Promise.all([
    supabase
      .from('call_logs')
      .select('id, created_at, outcome, contacts(full_name)')
      .eq('agent_id', agentId)
      .order('created_at', { ascending: false })
      .limit(limit),
    supabase
      .from('appointments')
      .select('id, created_at, status, contacts(full_name)')
      .eq('agent_id', agentId)
      .order('created_at', { ascending: false })
      .limit(limit),
    supabase
      .from('sales')
      .select('id, created_at, premium_cents, contacts(full_name)')
      .eq('agent_id', agentId)
      .order('created_at', { ascending: false })
      .limit(limit),
    supabase
      .from('recruiting_logs')
      .select('id, created_at, status, contacts(full_name)')
      .eq('agent_id', agentId)
      .order('created_at', { ascending: false })
      .limit(limit),
  ]);

  const items: RecentActivityItem[] = [
    ...(calls ?? []).map((c) => ({
      id: c.id,
      kind: 'call' as ActivityKind,
      createdAt: c.created_at,
      contactName: contactName(c.contacts as { full_name: string } | null),
      summary: `Called · ${c.outcome.replace('_', ' ')}`,
      status: CALL_STATUS[c.outcome] ?? { label: titleCase(c.outcome), tone: 'neutral' as StatusTone },
    })),
    ...(appts ?? []).map((a) => ({
      id: a.id,
      kind: 'appointment' as ActivityKind,
      createdAt: a.created_at,
      contactName: contactName(a.contacts as { full_name: string } | null),
      summary: `Appointment · ${a.status.replace('_', ' ')}`,
      status: APPOINTMENT_STATUS[a.status] ?? { label: titleCase(a.status), tone: 'neutral' as StatusTone },
    })),
    ...(sales ?? []).map((s) => ({
      id: s.id,
      kind: 'sale' as ActivityKind,
      createdAt: s.created_at,
      contactName: contactName(s.contacts as { full_name: string } | null),
      summary: `Sale · $${(s.premium_cents / 100).toLocaleString('en-CA')}`,
      status: { label: 'Sale', tone: 'ok' as StatusTone },
    })),
    ...(recruits ?? []).map((r) => ({
      id: r.id,
      kind: 'recruiting' as ActivityKind,
      createdAt: r.created_at,
      contactName: contactName(r.contacts as { full_name: string } | null),
      summary: `Recruiting · ${r.status.replace('_', ' ')}`,
      status: { label: titleCase(r.status), tone: 'neutral' as StatusTone },
    })),
  ];

  items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return items.slice(0, limit);
}
