import { requireLeader } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BackLink } from '@/components/shell/back-link';
import { nextMonday, todayIso, formatDisplayDate } from '@/lib/dates';
import { TargetForm } from './target-form';
import { AgentOverrideRow } from './agent-override-row';

const FALLBACK = {
  calls_per_week: 50,
  appts_held_per_week: 3,
  premium_cents_per_week: 18800,
  min_calls_per_day: 15,
};

// Org default + per-agent overrides (03-ui.md: "/team/targets, SMD-only").
//
// A saved goal is insert-only and always takes effect the coming Monday
// (never mutates a past week -- see setTargetAction), so every value shown
// here is resolved for *that* upcoming week rather than the current one.
// Resolving for the current week instead was the original bug: a freshly
// saved goal doesn't apply until Monday, so re-reading "this week"'s target
// right after saving showed the still-unaffected old value (org default
// FALLBACK on a brand new org) -- indistinguishable from the save having
// silently failed and "reset to default", even though it succeeded.
export default async function TeamTargetsPage() {
  const session = await requireLeader();
  const supabase = await createClient();

  const today = todayIso();
  const upcomingWeek = nextMonday(today);
  const effectiveMonday = formatDisplayDate(upcomingWeek);

  const [{ data: orgDefault }, { data: roster }] = await Promise.all([
    supabase.rpc('team_target', { p_agent_id: session.agent!.id, p_week: upcomingWeek }),
    supabase.rpc('team_week_summary', { p_week_start: upcomingWeek }),
  ]);

  const defaultTarget = orgDefault?.[0] ?? FALLBACK;
  const me = (roster ?? []).find((a) => a.agent_id === session.agent!.id);
  const agents = (roster ?? []).filter((a) => a.agent_id !== session.agent!.id);

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <h1 className="text-[28px] font-bold leading-[34px] tracking-heading-tight text-fg">Goals</h1>
        <BackLink href="/team" label="Team" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Org default</CardTitle>
        </CardHeader>
        <CardContent>
          <TargetForm agentId={null} current={defaultTarget} effectiveMonday={effectiveMonday} />
        </CardContent>
      </Card>

      {me && (
        <Card>
          <CardHeader>
            <CardTitle>My goal</CardTitle>
          </CardHeader>
          <CardContent>
            <AgentOverrideRow
              agentId={me.agent_id}
              fullName="Me"
              hasOverride={me.has_override}
              effectiveMonday={effectiveMonday}
              current={{
                calls_per_week: me.calls_target,
                appts_held_per_week: me.appts_held_target,
                premium_cents_per_week: Number(me.premium_cents_target),
                min_calls_per_day: defaultTarget.min_calls_per_day,
              }}
            />
          </CardContent>
        </Card>
      )}

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
                }}
              />
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
