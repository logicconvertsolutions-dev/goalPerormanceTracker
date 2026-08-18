-- Targets are set by the SMD. agent_id NULL = org-wide default.
-- effective_from versions them, so a past week is always scored against the
-- target that was live then: raising a target never turns a past week red.
create table public.targets (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references public.organizations(id) on delete cascade,
  agent_id               uuid references public.agents(id) on delete cascade,
  set_by                 uuid not null references public.agents(id),
  effective_from         date not null,
  calls_per_week         int not null default 50,
  appts_held_per_week    int not null default 3,
  premium_cents_per_week bigint not null default 18800,
  min_calls_per_day      int not null default 15,
  md_deadline            date,
  created_at             timestamptz not null default now()
);
-- Postgres treats NULLs as distinct in UNIQUE, so a plain constraint would
-- allow ten org defaults for the same Monday. Two partial indexes instead.
create unique index targets_org_default_uq on public.targets (org_id, effective_from)
  where agent_id is null;
create unique index targets_agent_uq on public.targets (org_id, agent_id, effective_from)
  where agent_id is not null;

create table public.invitations (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  email       text not null,
  upline_id   uuid not null references public.agents(id) on delete cascade,
  role        public.agent_role not null default 'associate',
  token_hash  text not null unique,       -- sha256 of the raw token, never the token
  expires_at  timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  revoked_at  timestamptz,
  created_by  uuid not null references public.agents(id),
  created_at  timestamptz not null default now()
);
create index invitations_email_idx on public.invitations (lower(email));

create table public.audit_log (
  id         bigserial primary key,
  org_id     uuid,
  actor_id   uuid,
  action     text not null,
  entity     text not null,
  entity_id  text,
  metadata   jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_log_org_idx on public.audit_log (org_id, created_at desc);
