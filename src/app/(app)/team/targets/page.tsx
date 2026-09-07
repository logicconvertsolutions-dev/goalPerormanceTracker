import { requireLeader } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BackLink } from '@/components/shell/back-link';
import { cycleBounds, nextCycleStart, todayIso, formatDisplayDate } from '@/lib/dates';
import { TargetForm } from './target-form';
import { AgentOverrideRow } from './agent-override-row';

const FALLBACK = {
  calls_per_cycle: 72,
  appts_held_per_cycle: 24,
  premium_cents_per_cycle: 25000,
  min_calls_per_day: 7,
};

// Org default + per-agent overrides (03-ui.md: "/team/targets, SMD-only").
//
// A saved goal is insert-only and always takes effect the start of the next
// 10-day cycle (never mutates a past cycle -- see setTargetAction), so every
// value shown here is resolved for *that* upcoming cycle rather than the
// current one. Resolving for the current cycle instead was the original
// bug: a freshly saved goal doesn't apply until the next cycle starts, so
// re-reading "this cycle"'s target right after saving showed the
// still-unaffected old value (org default FALLBACK on a brand new org) --
// indistinguishable from the save having silently failed and "reset to
// default", even though it succeeded.
export default async function TeamTargetsPage() {
  const session = await requireLeader();
  const supabase = await createClient();

  const today = todayIso(session.agent!.time_zone);
  const upcomingCycleStart = nextCycleStart(today);
  const upcomingCycleEnd = cycleBounds(new Date(upcomingCycleStart + 'T00:00:00Z')).to;
  const effectiveDate = formatDisplayDate(upcomingCycleStart);
  const currentCycle = cycleBounds(new Date(today + 'T00:00:00Z'));

  // The true org default (agent_id IS NULL), read directly rather than via
  // team_target/effective_target -- those resolve the *effective* target for
  // a specific agent (their own override, falling back to the org default),
  // so calling them with the SMD's own id returned the SMD's own effective
  // target here instead of the org's actual default. Saving that back with
  // agentId: null (as this "Org default" card always does) then silently
  // overwrote the real org default with whatever the SMD's personal
  // numbers happened to be -- the bug this now fixes.
  //
  // Fetched alongside the upcoming-cycle values above: the *currently* live
  // goal (org default row and roster resolved as of today's cycle, not the
  // upcoming one), shown as a plain read-only line on each card so the SMD
  // can see what's actually in effect right now next to what they're about
  // to set for next cycle -- avoids the confusion of the "Applies from"
  // date reading like it already happened.
  const [{ data: orgDefaultRow }, { data: roster }, { data: currentOrgDefaultRow }, { data: currentRoster }] =
    await Promise.all([
      supabase
        .from('targets')
        .select('calls_per_cycle, appts_held_per_cycle, premium_cents_per_cycle, min_calls_per_day')
        .eq('org_id', session.agent!.org_id!)
        .is('agent_id', null)
        .lte('effective_from', upcomingCycleStart)
        .order('effective_from', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.rpc('team_period_summary', { p_from: upcomingCycleStart, p_to: upcomingCycleEnd }),
      supabase
        .from('targets')
        .select('calls_per_cycle, appts_held_per_cycle, premium_cents_per_cycle, min_calls_per_day')
        .eq('org_id', session.agent!.org_id!)
        .is('agent_id', null)
        .lte('effective_from', currentCycle.from)
        .order('effective_from', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.rpc('team_period_summary', { p_from: currentCycle.from, p_to: currentCycle.to }),
    ]);

  const defaultTarget = orgDefaultRow ?? FALLBACK;
  const currentDefaultTarget = currentOrgDefaultRow ?? FALLBACK;
  // team_period_summary now returns min_calls_target (P20d migration,
  // applied to staging) alongside the other per-agent target columns, so
  // each card can show that agent's own value instead of always falling
  // back to the org default's. Cast rather than editing the generated
  // Database type -- types/database.ts is regenerated via `npm run types`
  // and isn't hand-edited; this narrows the one call site until that
  // regeneration happens, after which the cast becomes redundant (but
  // harmless) and can be dropped.
  const rosterRows = (roster ?? []) as unknown as Array<{
    agent_id: string;
    full_name: string;
    calls_target: number;
    appts_held_target: number;
    premium_cents_target: number;
    min_calls_target: number;
    has_override: boolean;
  }>;
  const me = rosterRows.find((a) => a.agent_id === session.agent!.id);
  const agents = rosterRows.filter((a) => a.agent_id !== session.agent!.id);

  const currentRosterRows = (currentRoster ?? []) as unknown as typeof rosterRows;
  const currentByAgentId = new Map(currentRosterRows.map((a) => [a.agent_id, a]));

  function currentGoalFor(agentId: string) {
    const row = currentByAgentId.get(agentId);
    return row
      ? {
          calls_per_cycle: row.calls_target,
          appts_held_per_cycle: row.appts_held_target,
          premium_cents_per_cycle: Number(row.premium_cents_target),
          min_calls_per_day: row.min_calls_target,
        }
      : currentDefaultTarget;
  }

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
          <TargetForm
            agentId={null}
            current={defaultTarget}
            currentGoal={currentDefaultTarget}
            effectiveDate={effectiveDate}
          />
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
              effectiveDate={effectiveDate}
              current={{
                calls_per_cycle: me.calls_target,
                appts_held_per_cycle: me.appts_held_target,
                premium_cents_per_cycle: Number(me.premium_cents_target),
                min_calls_per_day: me.min_calls_target,
              }}
              currentGoal={currentGoalFor(me.agent_id)}
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
                effectiveDate={effectiveDate}
                current={{
                  calls_per_cycle: a.calls_target,
                  appts_held_per_cycle: a.appts_held_target,
                  premium_cents_per_cycle: Number(a.premium_cents_target),
                  min_calls_per_day: a.min_calls_target,
                }}
                currentGoal={currentGoalFor(a.agent_id)}
              />
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
