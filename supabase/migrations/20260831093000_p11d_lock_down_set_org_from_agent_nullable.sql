-- P11c introduced set_org_from_agent_nullable() (a new SECURITY DEFINER
-- function name, not a reuse of the existing set_org_from_agent()) after
-- p1l's one-time bulk EXECUTE revoke already ran -- so unlike every other
-- SECURITY DEFINER function in this schema, it kept Postgres's default
-- PUBLIC execute grant and was reachable at /rest/v1/rpc/set_org_from_agent_nullable.
-- It would fail at runtime if called directly (trigger functions require
-- trigger context), but close the gap explicitly to match the same
-- lockdown every other function here already has.
revoke all on function public.set_org_from_agent_nullable() from public, anon, authenticated;
