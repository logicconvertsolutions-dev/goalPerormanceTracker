-- Restatement preview for P25 Phase A — shows exactly which `appts_set`
-- numbers will change, and by how much, BEFORE any migration is applied.
--
-- Read-only, and it computes the post-fix value in the query rather than
-- writing anything. Run it against staging and production, and put the
-- result in the Phase A PR body and the agent-facing announcement (§9 of
-- `.github/Spec Sheets/12-appointment-lifecycle-remediation.md`).
--
-- Portable: one statement, no psql meta-commands. Runs in the Supabase SQL
-- editor, psql, or any client.
--
-- WHY THIS EXISTS, SEPARATE FROM metrics-damage-report.sql
--   The damage report counts agent-days whose daily_metrics row was DELETED
--   (F1/F2). It cannot see F3/F4/F5, which leave the row in place and put a
--   WRONG NUMBER in it:
--     F3 — resolving an appointment erased the appts_set its booking created
--     F4 — a call log plus an appointment row for the same appointment
--          counted twice (still deferred to Phase B; shown here as a
--          positive delta that Phase A does NOT remove)
--     F5 — imported appointments counted on the import day, not their own
--   A clean damage report therefore does not mean the numbers are right.
--   This query is how you find out which ones move.
--
-- HOW TO READ IT
--   delta > 0  — the day was UNDERSTATED, almost always F3 (a booking whose
--                appointment has since been resolved). Phase A restores it.
--   delta < 0  — the day was OVERSTATED, almost always F5 (imported rows
--                piled onto the import day). Phase A moves them to their
--                own dates.
--   No rows returned — no appts_set value changes. Phase A is then purely
--   the F1/F2 guard fixes, and the announcement needs no restatement note.
--
-- Agent full_name is included because an SMD may need to explain a specific
-- agent's change. No prospect PII: no contact names, no notes.

with tz as (
  select id as agent_id, coalesce(time_zone, 'America/New_York') as zone
  from public.agents
),
candidate_days as (
  select agent_id, activity_date as day
    from public.daily_metrics
  union
  select cl.agent_id, cl.call_date
    from public.call_logs cl
   where cl.outcome = 'appointment_set'
  union
  select ap.agent_id,
         case when ap.import_row_hash is not null
              then ap.appt_date
              else (ap.created_at at time zone t.zone)::date
         end
    from public.appointments ap
    join tz t on t.agent_id = ap.agent_id
),
calc as (
  select
    d.agent_id,
    d.day,
    coalesce((
      select m.appts_set from public.daily_metrics m
      where m.agent_id = d.agent_id and m.activity_date = d.day
    ), 0) as current_value,
    (
      select count(*) from public.call_logs cl
      where cl.agent_id = d.agent_id
        and cl.call_date = d.day
        and cl.outcome = 'appointment_set'
    ) + (
      select count(*) from public.appointments ap
      join tz t on t.agent_id = ap.agent_id
      where ap.agent_id = d.agent_id
        and case when ap.import_row_hash is not null
                 then ap.appt_date
                 else (ap.created_at at time zone t.zone)::date
            end = d.day
    ) as new_value
  from candidate_days d
)
select
  a.full_name                       as agent,
  c.day                             as activity_date,
  c.current_value                   as appts_set_now,
  c.new_value                       as appts_set_after,
  c.new_value - c.current_value     as delta,
  case
    when c.new_value > c.current_value then 'understated (F3 restore)'
    else 'overstated (F5 re-date)'
  end                               as reason
from calc c
join public.agents a on a.id = c.agent_id
where c.current_value <> c.new_value
order by a.full_name, c.day;
