import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../../types/database';
import type { ReportTypeId } from './report-types';

// admin_activity_report/admin_targets_vs_actuals don't exist in
// types/database.ts yet (P21 migration is staged for review, not applied --
// see supabase/migrations/20260917100000_p21_admin_reports.sql). Scoped type
// assertion at this one call site rather than hand-editing the generated
// file, same convention as team/targets/page.tsx's P20d cast: once
// `npm run types` regenerates against a project with this migration applied,
// this interface becomes redundant (but harmless) and can be dropped in
// favor of the generated types.
interface ReportRpcClient {
  rpc(
    fn: 'admin_activity_report',
    args: { p_from: string; p_to: string; p_org_id: string | null }
  ): Promise<{
    data:
      | {
          agent_id: string;
          full_name: string;
          org_id: string | null;
          org_name: string | null;
          role: string;
          calls_made: number;
          appts_set: number;
          appts_held: number;
          sales_count: number;
          premium_cents: number;
        }[]
      | null;
    error: { message: string } | null;
  }>;
  rpc(
    fn: 'admin_targets_vs_actuals',
    args: { p_from: string; p_to: string; p_org_id: string | null }
  ): Promise<{
    data:
      | {
          agent_id: string;
          full_name: string;
          org_id: string | null;
          org_name: string | null;
          calls_made: number;
          appts_set: number;
          appts_held: number;
          premium_cents: number;
          calls_target: number;
          appts_held_target: number;
          premium_cents_target: number;
          min_calls_target: number;
          pct_calls: number | null;
          streak_days: number;
          has_override: boolean;
        }[]
      | null;
    error: { message: string } | null;
  }>;
}

export interface ReportQueryParams {
  type: ReportTypeId;
  orgId: string | null;
  from: string;
  to: string;
}

export type ReportRow = Record<string, string | number | boolean | null>;

// Shared by the page and the CSV export route so both always run the exact
// same query against the exact same filters -- the screen and the download
// can never drift from each other. `supabase` is the normal RLS-scoped
// client (agent_roster/org_summary read agents/organizations directly,
// already admin-readable via agents_admin_read/organizations_admin_read);
// `admin` is the service-role client, required for the two cross-agent RPCs
// since they grant EXECUTE to service_role only (see the P21 migration).
export async function fetchReportRows(
  supabase: SupabaseClient<Database>,
  admin: SupabaseClient<Database>,
  { type, orgId, from, to }: ReportQueryParams
): Promise<ReportRow[]> {
  switch (type) {
    case 'agent_roster': {
      const [{ data: agents }, { data: orgs }] = await Promise.all([
        supabase
          .from('agents')
          .select('id, full_name, email, role, status, org_id, upline_id, joined_at')
          .order('full_name'),
        supabase.from('organizations').select('id, name'),
      ]);
      const orgName = new Map((orgs ?? []).map((o) => [o.id, o.name]));
      const nameById = new Map((agents ?? []).map((a) => [a.id, a.full_name]));
      return (agents ?? [])
        .filter((a) => !orgId || a.org_id === orgId)
        .map((a) => ({
          full_name: a.full_name,
          email: a.email,
          org_name: a.org_id ? (orgName.get(a.org_id) ?? '—') : '—',
          role: a.role,
          upline_name: a.upline_id ? (nameById.get(a.upline_id) ?? '—') : '—',
          status: a.status,
          joined_at: a.joined_at,
        }));
    }

    case 'org_summary': {
      const [{ data: orgs }, { data: agents }] = await Promise.all([
        supabase.from('organizations').select('id, name, created_at').order('name'),
        supabase.from('agents').select('org_id, role, status'),
      ]);
      const counts = new Map<string, { total: number; active: number; leaders: number }>();
      for (const a of agents ?? []) {
        if (!a.org_id) continue;
        const c = counts.get(a.org_id) ?? { total: 0, active: 0, leaders: 0 };
        c.total += 1;
        if (a.status === 'active') c.active += 1;
        if (a.role === 'leader') c.leaders += 1;
        counts.set(a.org_id, c);
      }
      return (orgs ?? [])
        .filter((o) => !orgId || o.id === orgId)
        .map((o) => {
          const c = counts.get(o.id) ?? { total: 0, active: 0, leaders: 0 };
          return {
            name: o.name,
            agent_count: c.total,
            active_agent_count: c.active,
            leader_count: c.leaders,
            created_at: o.created_at,
          };
        });
    }

    case 'activity_summary': {
      const rpcClient = admin as unknown as ReportRpcClient;
      const { data } = await rpcClient.rpc('admin_activity_report', {
        p_from: from,
        p_to: to,
        p_org_id: orgId,
      });
      return (data ?? []).map((r) => ({
        full_name: r.full_name,
        org_name: r.org_name ?? '—',
        calls_made: r.calls_made,
        appts_set: r.appts_set,
        appts_held: r.appts_held,
        sales_count: r.sales_count,
        premium_cents: r.premium_cents,
      }));
    }

    case 'targets_vs_actuals': {
      const rpcClient = admin as unknown as ReportRpcClient;
      const { data } = await rpcClient.rpc('admin_targets_vs_actuals', {
        p_from: from,
        p_to: to,
        p_org_id: orgId,
      });
      return (data ?? []).map((r) => ({
        full_name: r.full_name,
        org_name: r.org_name ?? '—',
        calls_made: r.calls_made,
        calls_target: r.calls_target,
        pct_calls: r.pct_calls,
        appts_held: r.appts_held,
        appts_held_target: r.appts_held_target,
        premium_cents: r.premium_cents,
        premium_cents_target: r.premium_cents_target,
        min_calls_target: r.min_calls_target,
        streak_days: r.streak_days,
        has_override: r.has_override,
      }));
    }
  }
}
