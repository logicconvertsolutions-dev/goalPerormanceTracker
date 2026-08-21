-- P6: rate limit /api/import and the log mutation path (04-security.md).
-- This codebase has no actual /api/import HTTP route -- import and logging
-- are both Server Actions (commitImportAction, logCallAction) -- so this
-- rate-limits those call sites instead of a URL that doesn't exist.
--
-- Fixed-window counter, keyed by (caller, scope). No Upstash/Redis
-- dependency (CLAUDE.md rule 10): the whole check is one upsert against a
-- small Postgres table, which is exactly the amount of traffic this
-- product ever needs to survive.
create table private.rate_limits (
  rl_key      text not null,
  window_start timestamptz not null,
  count       int not null default 1,
  primary key (rl_key, window_start)
);
revoke all on private.rate_limits from anon, authenticated;

-- Keys off auth.uid() itself, not a client-supplied id -- otherwise an
-- authenticated caller could pass someone else's id and burn through their
-- rate limit budget for them. Lives in `public` (like my_target/team_target)
-- rather than `private` because it must be RPC-callable -- `private` isn't
-- in Supabase's exposed schema list at all, so a private.* function is
-- simply unreachable via supabase.rpc() regardless of grants.
create or replace function public.check_rate_limit(p_scope text, p_limit int, p_window_seconds int)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_key text := coalesce((select auth.uid())::text, 'anon') || ':' || p_scope;
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_count int;
begin
  insert into private.rate_limits (rl_key, window_start, count)
  values (v_key, v_window, 1)
  on conflict (rl_key, window_start) do update set count = private.rate_limits.count + 1
  returning count into v_count;

  -- Opportunistic cleanup, scoped to this key so it stays a cheap indexed
  -- delete rather than a table scan -- old windows for this caller/scope
  -- are worthless once several windows have passed.
  delete from private.rate_limits
  where rl_key = v_key and window_start < v_window - (p_window_seconds * 5 || ' seconds')::interval;

  return v_count <= p_limit;
end $$;
revoke all on function public.check_rate_limit(text, int, int) from public, anon;
grant execute on function public.check_rate_limit(text, int, int) to authenticated;
