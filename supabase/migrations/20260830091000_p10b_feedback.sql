-- P10b: in-app bug/issue/feedback reports, reachable from the account menu.
-- Same owner-row + admin-global-read shape as agents_admin_read/audit_admin_read
-- (p6d) -- operational text an agent chose to submit, not prospect PII, so a
-- global admin read is fine (CLAUDE.md rule 2 is about prospect PII
-- specifically, never this kind of product-feedback metadata).
create type public.feedback_category as enum ('bug', 'feature_request', 'feedback', 'other');
create type public.feedback_status   as enum ('new', 'reviewed', 'resolved');

create table public.feedback (
  id         uuid primary key default gen_random_uuid(),
  agent_id   uuid not null references public.agents(id) on delete cascade,
  org_id     uuid not null references public.organizations(id),
  category   public.feedback_category not null default 'bug',
  subject    text not null,
  message    text not null,
  page_url   text,
  status     public.feedback_status not null default 'new',
  created_at timestamptz not null default now()
);
create index feedback_org_created_idx on public.feedback (org_id, created_at desc);
create index feedback_agent_idx on public.feedback (agent_id);

-- org_id derived from the submitting agent, never client input -- same
-- set_org_from_agent() trigger every other owner-scoped table uses (p1e).
create trigger feedback_org before insert or update of agent_id on public.feedback
  for each row execute function public.set_org_from_agent();

alter table public.feedback enable row level security;

create policy feedback_insert on public.feedback for insert to authenticated
  with check ( agent_id = (select auth.uid()) );
create policy feedback_select_own on public.feedback for select to authenticated
  using ( agent_id = (select auth.uid()) );
create policy feedback_admin_read on public.feedback for select to authenticated
  using ( (select private.my_role()) = 'admin' );
create policy feedback_admin_update on public.feedback for update to authenticated
  using ( (select private.my_role()) = 'admin' )
  with check ( (select private.my_role()) = 'admin' );

-- Only an admin marking a report reviewed/resolved should ever change a row
-- after the reporter submits it -- same column-grant pattern as agents.
revoke update on public.feedback from authenticated;
grant update (status) on public.feedback to authenticated;
