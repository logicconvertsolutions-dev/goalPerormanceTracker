import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../types/database';
import type { ActivityKind } from '@/components/shell/activity-icons';

export interface RecentActivityItem {
  id: string;
  kind: ActivityKind;
  createdAt: string;
  contactName: string;
  summary: string;
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
    })),
    ...(appts ?? []).map((a) => ({
      id: a.id,
      kind: 'appointment' as ActivityKind,
      createdAt: a.created_at,
      contactName: contactName(a.contacts as { full_name: string } | null),
      summary: `Appointment · ${a.status.replace('_', ' ')}`,
    })),
    ...(sales ?? []).map((s) => ({
      id: s.id,
      kind: 'sale' as ActivityKind,
      createdAt: s.created_at,
      contactName: contactName(s.contacts as { full_name: string } | null),
      summary: `Sale · $${(s.premium_cents / 100).toLocaleString('en-CA')}`,
    })),
    ...(recruits ?? []).map((r) => ({
      id: r.id,
      kind: 'recruiting' as ActivityKind,
      createdAt: r.created_at,
      contactName: contactName(r.contacts as { full_name: string } | null),
      summary: `Recruiting · ${r.status.replace('_', ' ')}`,
    })),
  ];

  items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return items.slice(0, limit);
}
