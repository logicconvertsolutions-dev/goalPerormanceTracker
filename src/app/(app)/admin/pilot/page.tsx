import { requireAdmin } from '@/lib/auth/guards';
import { createAdminClient } from '@/lib/supabase/admin';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatDisplayDate } from '@/lib/dates';

const WINDOW_DAYS = 10;
const MIN_ACTIVE_DAYS = 8;

interface Row {
  org_id: string;
  org_name: string;
  agent_id: string;
  full_name: string;
  activity_date: string;
  logged: boolean;
}

interface AgentSummary {
  agentId: string;
  fullName: string;
  loggedByDate: Map<string, boolean>;
  daysActive: number;
}

// P7 (06-build-phases.md): "Instrument daily active loggers, not signups.
// If fewer than 2 of 3 log on 8 of 10 working days, the problem is the
// logging flow -- fix P3, do not build features." This page is that
// instrument; everything else about running the pilot is Deepak's call,
// not a screen's.
export default async function AdminPilotPage() {
  await requireAdmin();
  const admin = createAdminClient();

  const { data: rows } = await admin.rpc('admin_daily_active_loggers', { p_days: WINDOW_DAYS });
  const allRows = (rows ?? []) as Row[];

  const dates = [...new Set(allRows.map((r) => r.activity_date))].sort();

  const byOrg = new Map<string, { orgName: string; agents: Map<string, AgentSummary> }>();
  for (const row of allRows) {
    if (!byOrg.has(row.org_id)) {
      byOrg.set(row.org_id, { orgName: row.org_name, agents: new Map() });
    }
    const org = byOrg.get(row.org_id)!;
    if (!org.agents.has(row.agent_id)) {
      org.agents.set(row.agent_id, {
        agentId: row.agent_id,
        fullName: row.full_name,
        loggedByDate: new Map(),
        daysActive: 0,
      });
    }
    const agent = org.agents.get(row.agent_id)!;
    agent.loggedByDate.set(row.activity_date, row.logged);
    if (row.logged) agent.daysActive += 1;
  }

  return (
    <div className="space-y-4 max-w-4xl">
      <h1 className="text-xl font-semibold tracking-heading-tight text-fg">Pilot</h1>
      <p className="text-sm text-fg-3">
        Daily active loggers over the last {WINDOW_DAYS} business days. Signups don&apos;t matter
        here — only who actually logged something.
      </p>

      {byOrg.size === 0 ? (
        <p className="text-sm text-fg-3">No active agents yet.</p>
      ) : (
        [...byOrg.entries()].map(([orgId, org]) => {
          const agents = [...org.agents.values()].sort((a, b) => a.fullName.localeCompare(b.fullName));
          const meetingBar = agents.filter((a) => a.daysActive >= MIN_ACTIVE_DAYS).length;
          // The spec's literal rule is pilot-scale ("2 of 3") -- generalised
          // here as "at least two thirds of active agents", so this still
          // means something once the roster isn't exactly three people.
          const atRisk = agents.length > 0 && meetingBar < Math.ceil((agents.length * 2) / 3);

          return (
            <Card key={orgId}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>{org.orgName}</CardTitle>
                  {atRisk ? (
                    <Badge variant="bad">
                      {meetingBar} of {agents.length} logging {MIN_ACTIVE_DAYS}/{WINDOW_DAYS} days
                    </Badge>
                  ) : (
                    <Badge variant="ok">
                      {meetingBar} of {agents.length} logging {MIN_ACTIVE_DAYS}/{WINDOW_DAYS} days
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {atRisk && (
                  <p className="text-xs text-bad mb-3">
                    Fewer than two thirds of this org&apos;s active agents are logging {MIN_ACTIVE_DAYS} of
                    the last {WINDOW_DAYS} working days. Per the pilot plan, that means the logging
                    flow needs fixing — it is not a sign to build more features.
                  </p>
                )}
                <div className="overflow-x-auto">
                  <table className="text-sm">
                    <thead>
                      <tr className="border-b border-line text-left text-fg-3">
                        <th className="py-1.5 pr-3 font-medium">Agent</th>
                        {dates.map((d) => (
                          <th key={d} className="py-1.5 px-1.5 font-medium text-center whitespace-nowrap">
                            {formatDisplayDate(d)}
                          </th>
                        ))}
                        <th className="py-1.5 pl-3 font-medium text-right">Days active</th>
                      </tr>
                    </thead>
                    <tbody>
                      {agents.map((agent) => (
                        <tr key={agent.agentId} className="border-b border-line last:border-0">
                          <td className="py-1.5 pr-3 text-fg whitespace-nowrap">{agent.fullName}</td>
                          {dates.map((d) => (
                            <td key={d} className="py-1.5 px-1.5 text-center">
                              {agent.loggedByDate.get(d) ? (
                                <span className="text-ok" aria-label="logged">
                                  ●
                                </span>
                              ) : (
                                <span className="text-fg-4" aria-label="not logged">
                                  ·
                                </span>
                              )}
                            </td>
                          ))}
                          <td className="py-1.5 pl-3 text-right font-mono tabular-nums text-fg">
                            {agent.daysActive}/{WINDOW_DAYS}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
