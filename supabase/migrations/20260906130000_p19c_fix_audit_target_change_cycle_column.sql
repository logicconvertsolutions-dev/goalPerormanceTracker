-- P19c: public.audit_target_change() (the targets_audit trigger,
-- 20260818132848_p1j_invite_only_signup.sql) still referenced
-- new.calls_per_week directly in its jsonb_build_object metadata. P17a
-- renamed that column to calls_per_cycle; since this function reads the
-- column name from the NEW row rather than through a wrapper, every insert
-- or update on public.targets (saving org default goals, saving a
-- per-agent override) has been raising "record "new" has no field
-- "calls_per_week"" since P17a shipped -- a trigger, so it wasn't caught by
-- P19a's sweep of team_period_summary and friends (those are plain
-- functions referencing effective_target's return shape; this one reads
-- the base table row directly and was missed).
create or replace function public.audit_target_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, metadata)
  values (new.org_id, (select auth.uid()), lower(tg_op) || '.target', 'target', new.id::text,
          jsonb_build_object('agent_id', new.agent_id, 'effective_from', new.effective_from,
                             'calls', new.calls_per_cycle, 'min_per_day', new.min_calls_per_day));
  return new;
end $$;
