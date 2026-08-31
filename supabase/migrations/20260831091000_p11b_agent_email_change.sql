-- P11b: /admin/agents gets a per-agent detail view and the ability to
-- change an agent's email. The email itself only updates once the agent
-- confirms it (clicks the link sent to the *new* address) -- an admin
-- can't silently swap someone's login email out from under them. Same
-- hashed-token, service-role-only shape as invitations (p1a/p1m): the
-- confirm step has no session (the agent may not even be signed in when
-- they click the link), so it must be reachable without auth.uid().
create table public.agent_email_changes (
  id           uuid primary key default gen_random_uuid(),
  agent_id     uuid not null references public.agents(id) on delete cascade,
  new_email    text not null,
  token_hash   text not null unique,
  requested_by uuid not null references public.agents(id),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default (now() + interval '7 days'),
  confirmed_at timestamptz
);
create index agent_email_changes_agent_idx on public.agent_email_changes (agent_id);
alter table public.agent_email_changes enable row level security;
-- No policies: written and read only by the service-role client (the admin
-- action that creates the request, and the no-session confirm page/action
-- that consumes it), same lockdown pattern as invitations' token lookup
-- already relies on RLS being irrelevant to a service-role client.
revoke all on public.agent_email_changes from anon, authenticated;
