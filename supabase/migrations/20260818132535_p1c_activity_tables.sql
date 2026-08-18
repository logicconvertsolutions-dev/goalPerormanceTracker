create table public.call_logs (
  id              uuid primary key default gen_random_uuid(),
  agent_id        uuid not null references public.agents(id) on delete cascade,
  org_id          uuid not null references public.organizations(id),
  contact_id      uuid not null references public.contacts(id) on delete cascade,
  call_date       date not null default current_date,
  source          public.call_source  not null,
  outcome         public.call_outcome not null,
  notes           text,
  -- The field the product turns on: 5 of 7 notes in the source workbook said
  -- some form of "call back". This is what makes /today exist.
  follow_up_on      date,
  follow_up_done_at timestamptz,
  import_row_hash text,
  created_at      timestamptz not null default now()
);
create index call_logs_agent_date_idx on public.call_logs (agent_id, call_date);
create index call_logs_org_idx on public.call_logs (org_id);
-- Powers /today
create index call_logs_followup_idx on public.call_logs (agent_id, follow_up_on)
  where follow_up_on is not null and follow_up_done_at is null;
create unique index call_logs_import_uq on public.call_logs (agent_id, import_row_hash)
  where import_row_hash is not null;

create table public.appointments (
  id                     uuid primary key default gen_random_uuid(),
  agent_id               uuid not null references public.agents(id) on delete cascade,
  org_id                 uuid not null references public.organizations(id),
  contact_id             uuid not null references public.contacts(id) on delete cascade,
  appt_date              date not null,
  appt_type              text,
  status                 public.appt_status not null default 'scheduled',
  expected_premium_cents bigint not null default 0,
  referrals_given        int not null default 0,
  notes                  text,
  import_row_hash        text,
  created_at             timestamptz not null default now()
);
create index appointments_agent_date_idx on public.appointments (agent_id, appt_date);
create index appointments_org_idx on public.appointments (org_id);
create unique index appointments_import_uq on public.appointments (agent_id, import_row_hash)
  where import_row_hash is not null;

create table public.sales (
  id              uuid primary key default gen_random_uuid(),
  agent_id        uuid not null references public.agents(id) on delete cascade,
  org_id          uuid not null references public.organizations(id),
  contact_id      uuid references public.contacts(id) on delete set null,
  appointment_id  uuid references public.appointments(id) on delete set null,
  sale_date       date not null,
  product_type    text,
  premium_cents   bigint not null default 0,
  notes           text,
  import_row_hash text,
  created_at      timestamptz not null default now()
);
create index sales_agent_date_idx on public.sales (agent_id, sale_date);
create index sales_org_idx on public.sales (org_id);
create unique index sales_import_uq on public.sales (agent_id, import_row_hash)
  where import_row_hash is not null;

create table public.recruiting_logs (
  id              uuid primary key default gen_random_uuid(),
  agent_id        uuid not null references public.agents(id) on delete cascade,
  org_id          uuid not null references public.organizations(id),
  contact_id      uuid references public.contacts(id) on delete set null,
  log_date        date not null default current_date,
  source          public.call_source,
  status          public.recruit_status not null default 'contacted',
  notes           text,
  import_row_hash text,
  created_at      timestamptz not null default now()
);
create index recruiting_agent_date_idx on public.recruiting_logs (agent_id, log_date);
create index recruiting_org_idx on public.recruiting_logs (org_id);
create unique index recruiting_import_uq on public.recruiting_logs (agent_id, import_row_hash)
  where import_row_hash is not null;
