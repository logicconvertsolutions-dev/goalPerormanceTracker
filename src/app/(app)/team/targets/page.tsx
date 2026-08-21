import Link from 'next/link';
import { requireLeader } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { nextMonday, todayIso, weekStart, formatDisplayDate } from '@/lib/dates';
import { TargetForm } from './target-form';
import { AgentOverrideRow } from './agent-override-row';

const FALLBACK = {
  calls_per_week: 50,
  appts_held_per_week: 3,
  premium_cents_per_week: 18800,
  min_calls_per_day: 15,
  md_deadline: null as string | null,
};

// Org default + per-agent overrides (03-ui.md: "/team/targets, SMD-only").
export default async function TeamTargetsPage() {
  const session = await requireLeader();
  const supabase = await createClient();

  const today = todayIso();
  const currentWeek = weekStart(new Date(today + 'T00:00:00Z'));
  const effectiveMonday = formatDisplayDate(nextMonday(today));

  const [{ data: orgDefault }, { data: roster }] = await Promise.all([
    supabase.rpc('team_target', { p_agent_id: session.agent!.id, p_week: currentWeek }),
    supabase.rpc('team_week_summary', { p_week_start: currentWeek }),
  ]);

  const defaultTarget = orgDefault?.[0] ?? FALLBACK;
  const agents = (roster ?? []).filter((a) => a.agent_id !== session.agent!.id);

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-heading-tight text-fg">Targets</h1>
        <Link href="/team" className="text-sm text-acc hover:underline">
          ← Team
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Org default</CardTitle>
        </CardHeader>
        <CardContent>
          <TargetForm agentId={null} current={defaultTarget} effectiveMonday={effectiveMonday} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Per-agent overrides</CardTitle>
        </CardHeader>
        <CardContent>
          {agents.length === 0 ? (
            <p className="text-sm text-fg-3">No one on your team yet.</p>
          ) : (
            agents.map((a) => (
              <AgentOverrideRow
                key={a.agent_id}
                agentId={a.agent_id}
                fullName={a.full_name}
                hasOverride={a.has_override}
                effectiveMonday={effectiveMonday}
                current={{
                  calls_per_week: a.calls_target,
                  appts_held_per_week: a.appts_held_target,
                  premium_cents_per_week: Number(a.premium_cents_target),
                  min_calls_per_day: defaultTarget.min_calls_per_day,
                  md_deadline: null,
                }}
              />
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
