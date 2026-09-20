-- Restatement preview for P25 Phase C2 — shows exactly whose no-show rate
-- changes, and by how much, BEFORE the deploy.
--
-- Read-only. It computes both the old and the new rate in the query and
-- writes nothing. Run it against staging and production, and put the
-- result in the C2 PR body and the agent-facing announcement (§9 of
-- `.github/Spec Sheets/12-appointment-lifecycle-remediation.md`).
--
-- Portable: one statement, no psql meta-commands. Runs in the Supabase SQL
-- editor, psql, or any client.
--
-- WHY THIS EXISTS, SEPARATE FROM metrics-restatement-preview.sql
--   That file previews `appts_set`, which is a STORED counter — Phase A
--   changed the numbers in daily_metrics itself. The no-show rate is not
--   stored anywhere. C2 changes the FORMULA that divides unchanged
--   counters:
--
--     before   no_show / (scheduled + held + no_show + rescheduled + cancelled)
--     after    no_show / (held + no_show + cancelled)
--
--   Nothing in the database moves, so a metrics-snapshot diff will show
--   this as zero. The only way to see it coming is to compute both rates,
--   which is what this does.
--
--   Two appointments leave the denominator, each for its own reason (D3):
--   a `scheduled` one has no outcome yet, so counting it makes the rate
--   drift upward through a cycle as appointments resolve; a `rescheduled`
--   one is continued by a successor that is counted in its own right, so
--   counting both charges one prospect to the denominator twice.
--
-- Contains no prospect PII: counts and rates per agent-cycle only.

with by_cycle as (
  select
    m.agent_id,
    a.full_name,
    a.org_id,
    public.cycle_start(m.activity_date) as cycle_start,
    sum(m.appt_scheduled)   as scheduled,
    sum(m.appt_held)        as held,
    sum(m.appt_no_show)     as no_show,
    sum(m.appt_rescheduled) as rescheduled,
    sum(m.appt_cancelled)   as cancelled
  from public.daily_metrics m
  join public.agents a on a.id = m.agent_id
  group by 1, 2, 3, 4
),
rated as (
  select
    *,
    (scheduled + held + no_show + rescheduled + cancelled) as old_denominator,
    (held + no_show + cancelled)                           as new_denominator
  from by_cycle
)
select
  full_name,
  org_id,
  cycle_start,
  no_show,
  old_denominator,
  new_denominator,
  case when old_denominator = 0 then 0
       else round(100.0 * no_show / old_denominator) end as old_rate_pct,
  case when new_denominator = 0 then 0
       else round(100.0 * no_show / new_denominator) end as new_rate_pct,
  case
    when no_show = 0 then 'no change — rate is 0% either way'
    when new_denominator = 0 then 'NEW: undefined denominator, shows 0%'
    when old_denominator = new_denominator then 'no change'
    else 'RESTATED'
  end as effect
from rated
-- Only cycles where an agent could actually notice. A cycle with no
-- no-shows reads 0% under both formulas however the denominator moves,
-- and listing those buries the handful of rows that do change.
where no_show > 0
  and (scheduled + rescheduled) > 0
order by abs(
  case when new_denominator = 0 then 0 else 100.0 * no_show / new_denominator end
  - case when old_denominator = 0 then 0 else 100.0 * no_show / old_denominator end
) desc,
  full_name, cycle_start;

-- An empty result means the restatement is invisible: every agent-cycle
-- either has no no-shows at all, or has no pending/rescheduled
-- appointments to remove from its denominator. That was production's
-- state on 2026-09-20 — which is what made that a cheap moment to ship it.
