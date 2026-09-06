-- P19d: setTargetAction (team/targets/actions.ts) has always done a plain
-- .insert() into public.targets, unchanged since P5's original
-- implementation -- effective_from is always "the start of the next
-- period" (nextMonday, now nextCycleStart), so saving a goal a second time
-- before that boundary is reached recomputes the *same* effective_from and
-- collides with targets_org_default_uq (org_id, effective_from) or
-- targets_agent_uq (org_id, agent_id, effective_from): "duplicate key value
-- violates unique constraint". This is not a new regression from the
-- cycle-cadence change -- the identical collision existed with
-- nextMonday() any time an SMD adjusted a pending goal twice in the same
-- week -- it just wasn't caught until now.
--
-- A row whose effective_from hasn't been reached yet has never scored
-- anything (CLAUDE.md rule 8 protects *past* rows, not future ones), so
-- correcting a still-pending goal in place is safe and is what the /team/
-- targets UI already implies: it always displays and edits "the value that
-- will apply next cycle" as a single row, not a growing list of same-cycle
-- attempts.
--
-- PostgREST's .upsert() can't target these indexes -- they're partial
-- (`where agent_id is [not] null`), and an ON CONFLICT arbiter for a
-- partial index must repeat that exact predicate, which supabase-js's
-- on_conflict=columns query param has no way to express. Postgres itself
-- supports it fine in a plain INSERT ... ON CONFLICT (...) WHERE ... DO
-- UPDATE statement, so this needs a dedicated RPC. security definer with
-- inline authorization checks (not security invoker relying on RLS)
-- to match this codebase's own convention for mutation RPCs (e.g.
-- set_auto_call_nudges, p12a) -- the checks below are exactly
-- targets_insert's own WITH CHECK clause (p1h), replicated here since an
-- ON CONFLICT DO UPDATE needs both the INSERT and UPDATE policies to pass
-- and targets_update's USING clause doesn't itself carry the
-- is_upline_of check.
create or replace function public.set_target(
  p_agent_id uuid,
  p_effective_from date,
  p_calls_per_cycle int,
  p_appts_held_per_cycle int,
  p_premium_cents_per_cycle bigint,
  p_min_calls_per_day int
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := (select auth.uid());
  v_role public.agent_role;
  v_org uuid;
begin
  select role, org_id into v_role, v_org from public.agents where id = v_me;
  if v_role not in ('leader', 'admin') or v_org is null then
    raise exception 'only a leader or admin with an organization can set a goal';
  end if;
  if p_agent_id is not null and not (select private.is_upline_of(p_agent_id)) then
    raise exception 'agent is not in caller''s downline';
  end if;

  if p_agent_id is null then
    insert into public.targets (
      org_id, agent_id, set_by, effective_from,
      calls_per_cycle, appts_held_per_cycle, premium_cents_per_cycle, min_calls_per_day
    )
    values (
      v_org, null, v_me, p_effective_from,
      p_calls_per_cycle, p_appts_held_per_cycle, p_premium_cents_per_cycle, p_min_calls_per_day
    )
    on conflict (org_id, effective_from) where agent_id is null
    do update set
      set_by = excluded.set_by,
      calls_per_cycle = excluded.calls_per_cycle,
      appts_held_per_cycle = excluded.appts_held_per_cycle,
      premium_cents_per_cycle = excluded.premium_cents_per_cycle,
      min_calls_per_day = excluded.min_calls_per_day;
  else
    insert into public.targets (
      org_id, agent_id, set_by, effective_from,
      calls_per_cycle, appts_held_per_cycle, premium_cents_per_cycle, min_calls_per_day
    )
    values (
      v_org, p_agent_id, v_me, p_effective_from,
      p_calls_per_cycle, p_appts_held_per_cycle, p_premium_cents_per_cycle, p_min_calls_per_day
    )
    on conflict (org_id, agent_id, effective_from) where agent_id is not null
    do update set
      set_by = excluded.set_by,
      calls_per_cycle = excluded.calls_per_cycle,
      appts_held_per_cycle = excluded.appts_held_per_cycle,
      premium_cents_per_cycle = excluded.premium_cents_per_cycle,
      min_calls_per_day = excluded.min_calls_per_day;
  end if;
end $$;
revoke all on function public.set_target(uuid, date, int, int, bigint, int) from public, anon;
grant execute on function public.set_target(uuid, date, int, int, bigint, int) to authenticated;
