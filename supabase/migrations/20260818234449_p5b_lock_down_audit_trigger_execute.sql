-- audit_target_insert is a trigger function, never meant to be called
-- directly -- it defaulted to PUBLIC EXECUTE like every SECURITY DEFINER
-- function does unless explicitly revoked (same reason p1l revoked the
-- whole schema once). Triggers don't need EXECUTE granted to fire; only
-- direct RPC callers do.
--
-- Guarded rather than a bare `revoke`: this function was created directly on
-- the remote database (never by a migration file in this repo -- see
-- p5a_team_dashboard_rpcs.sql's closing comment, which explicitly says no
-- new trigger was added) and was dropped again two migrations later by
-- p5c_drop_redundant_targets_audit_trigger.sql. A `supabase db reset` from
-- these migrations alone therefore never creates it, and an unguarded revoke
-- fails with "function does not exist" on a fresh database. The guard makes
-- this migration idempotent for a from-scratch reset while remaining the
-- exact same statement it always was against the already-applied remote.
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'audit_target_insert' and p.pronargs = 0
  ) then
    revoke all on function public.audit_target_insert() from public, anon, authenticated;
  end if;
end $$;
