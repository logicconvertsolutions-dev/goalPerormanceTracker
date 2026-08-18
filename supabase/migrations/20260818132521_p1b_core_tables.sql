-- Tenant fence. Two SMD orgs on one database; they must never see each other.
create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  owner_id    uuid,                       -- SMD; FK added after agents exists
  created_at  timestamptz not null default now()
);

create table public.agents (
  id          uuid primary key references auth.users(id) on delete cascade,
  org_id      uuid not null references public.organizations(id) on delete restrict,
  full_name   text not null,
  email       text not null,
  upline_id   uuid references public.agents(id) on delete set null,
  role        public.agent_role   not null default 'associate',
  status      public.agent_status not null default 'active',
  joined_at   date not null default current_date,
  created_at  timestamptz not null default now()
);
create unique index agents_email_uq on public.agents (lower(email));
create index agents_upline_idx on public.agents (upline_id);
create index agents_org_idx     on public.agents (org_id);

alter table public.organizations
  add constraint organizations_owner_fk
  foreign key (owner_id) references public.agents(id) on delete set null;

-- Closure table. A recursive CTE inside an RLS policy re-executes per row and
-- collapses at scale; this makes "is X in Y's downline" one indexed EXISTS.
-- Two levels today, but WFG hierarchies deepen and retrofitting is painful.
create table public.agent_closure (
  ancestor_id   uuid not null references public.agents(id) on delete cascade,
  descendant_id uuid not null references public.agents(id) on delete cascade,
  depth         int  not null,
  primary key (ancestor_id, descendant_id)
);
create index agent_closure_desc_idx on public.agent_closure (descendant_id);

-- Contacts are PEOPLE, not call rows, so history accumulates per person.
-- Deliberately no phone or email column: not needed, and not storing them
-- keeps the PIPEDA surface small.
create table public.contacts (
  id         uuid primary key default gen_random_uuid(),
  agent_id   uuid not null references public.agents(id) on delete cascade,
  org_id     uuid not null references public.organizations(id),
  full_name  text not null,
  company    text,
  created_at timestamptz not null default now()
);
create unique index contacts_agent_name_uq on public.contacts (agent_id, lower(full_name));
create index contacts_agent_idx on public.contacts (agent_id);
