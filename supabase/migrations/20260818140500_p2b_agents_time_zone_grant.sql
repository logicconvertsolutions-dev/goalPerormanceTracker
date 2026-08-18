-- time_zone (added in p2a) needs the same self-service column grant as
-- full_name -- it's not a privileged column (role/upline_id/org_id/status
-- are), so an agent should be able to set their own without going through
-- the guard trigger's admin-only path.
grant update (full_name, time_zone) on public.agents to authenticated;
