# Data model, RLS, and RPCs

## Design decisions (and why)

**Organizations are a hard fence.** Two SMD teams, two paying customers. Every
table carries `org_id`, every policy checks it, and a trigger rejects any
`upline_id` that crosses organizations. The closure table already scopes access
correctly — `org_id` is defence in depth, plus the place to hang plan, settings,
and billing later. One redundant check is cheap; one SMD seeing the other's
roster ends the business.

**Hierarchy = self-FK + closure table.** `agents.upline_id` is the truth;
`agent_closure(ancestor_id, descendant_id, depth)` is the index. A recursive CTE
inside an RLS policy re-executes per row and collapses at a few thousand rows.
A closure table makes "is X in Y's downline" a single indexed EXISTS.

*Two levels today, so `upline_id` alone would work.* Keep the closure table
anyway: WFG hierarchies deepen by design — the moment one associate promotes and
sponsors their own people, flat breaks, and retrofitting hierarchy into live
policies is a migration you do not want with paying customers on the system. Cost
today is one trigger and one table.

**Two access tiers, not one.**
- Tier 1 — row access: `agent_id = auth.uid()`. Full row, including PII.
- Tier 2 — aggregate access: upline calls a `SECURITY DEFINER` RPC that returns
  counts and sums. No policy ever grants an upline SELECT on a PII row.

This is the whole security architecture. A leaked policy on tier 1 exposes one
agent's prospects; there is no policy that could leak the whole downline's,
because none exists.

**Every SECURITY DEFINER function gets `set search_path = ''`** and
fully-qualified names, or it is a privilege-escalation vector via a
search-path-shadowed table.

---

## Schema

```sql
create extension if not exists citext;
create schema if not exists private;   -- helper fns, NOT in exposed schemas

create type public.agent_role   as enum ('associate','leader','admin');
create type public.agent_status as enum ('active','inactive');
create type public.call_source  as enum
  ('warm_market','referral','cold','social_media','friend','other');
create type public.call_outcome as enum
  ('connected','voicemail','no_answer','appointment_set','not_interested');
create type public.appt_status  as enum
  ('scheduled','held','no_show','rescheduled','cancelled');
create type public.recruit_status as enum
  ('contacted','interviewed','joined','licensed','declined');

create table public.organizations (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  owner_id     uuid,                    -- the SMD; FK added after agents exists
  created_at   timestamptz not null default now()
);

create table public.agents (
  id          uuid primary key references auth.users(id) on delete cascade,
  org_id      uuid not null references public.organizations(id) on delete restrict,
  full_name   text not null,
  email       citext not null unique,
  upline_id   uuid references public.agents(id) on delete set null,
  role        public.agent_role   not null default 'associate',
  status      public.agent_status not null default 'active',
  joined_at   date not null default current_date,
  created_at  timestamptz not null default now()
);
create index on public.agents (upline_id);
create index on public.agents (org_id);

-- Hard fence: an upline must live in the same organization.
create or replace function public.enforce_same_org()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.upline_id is not null
     and (select a.org_id from public.agents a where a.id = new.upline_id) <> new.org_id
  then raise exception 'upline_id crosses organization boundary';
  end if;
  return new;
end $$;
create trigger agents_same_org before insert or update on public.agents
  for each row execute function public.enforce_same_org();

create table public.agent_closure (
  ancestor_id   uuid not null references public.agents(id) on delete cascade,
  descendant_id uuid not null references public.agents(id) on delete cascade,
  depth         int  not null,
  primary key (ancestor_id, descendant_id)
);
create index on public.agent_closure (descendant_id);
```

Closure maintenance: `after insert` inserts self-row `(id,id,0)` plus
`(a, new.id, depth+1)` for every ancestor of `upline_id`.
`after update of upline_id` deletes the subtree's cross-boundary edges and
rebuilds them. Guard against cycles: reject if `new.upline_id` is already a
descendant. **Write this as a tested trigger, not application code.**

```sql
-- Contacts are PEOPLE, not call rows. An agent calls the same prospect five
-- times over two months; without this table that history scatters across five
-- unrelated rows and the agent cannot answer "what did I say to them last time".
-- Owned strictly by one agent. No phone or email column — we do not need them,
-- and not storing them keeps the PIPEDA surface small.
create table public.contacts (
  id         uuid primary key default gen_random_uuid(),
  agent_id   uuid not null references public.agents(id) on delete cascade,
  org_id     uuid not null references public.organizations(id),
  full_name  text not null,            -- PII
  company    text,
  created_at timestamptz not null default now(),
  unique (agent_id, lower(full_name))
);
create index on public.contacts (agent_id);

create table public.call_logs (
  id           uuid primary key default gen_random_uuid(),
  agent_id     uuid not null references public.agents(id) on delete cascade,
  org_id       uuid not null references public.organizations(id),
  contact_id   uuid not null references public.contacts(id) on delete cascade,
  call_date    date not null default current_date,
  -- THE FIELD THE PRODUCT TURNS ON. Five of seven rows in the source workbook
  -- said some form of "call back on X". Setting this is what makes tomorrow's
  -- /today list exist.
  follow_up_on date,
  follow_up_done_at timestamptz,
  source       public.call_source  not null,
  outcome      public.call_outcome not null,
  notes        text,                   -- PII
  created_at   timestamptz not null default now()
);
create index on public.call_logs (agent_id, call_date);
create index on public.call_logs (org_id);
-- Powers /today: due follow-ups for one agent, cheapest possible lookup.
create index on public.call_logs (agent_id, follow_up_on)
  where follow_up_on is not null and follow_up_done_at is null;

create table public.appointments (
  id               uuid primary key default gen_random_uuid(),
  agent_id         uuid not null references public.agents(id) on delete cascade,
  org_id           uuid not null references public.organizations(id),
  contact_id       uuid not null references public.contacts(id) on delete cascade,
  appt_date        date not null,
  appt_type        text,
  status           public.appt_status not null default 'scheduled',
  expected_premium_cents bigint not null default 0,
  referrals_given  int not null default 0,
  notes            text,               -- PII
  created_at       timestamptz not null default now()
);
create index on public.appointments (agent_id, appt_date);

create table public.sales (
  id            uuid primary key default gen_random_uuid(),
  agent_id      uuid not null references public.agents(id) on delete cascade,
  org_id        uuid not null references public.organizations(id),
  sale_date     date not null,
  client_name   text not null,         -- PII
  product_type  text,
  premium_cents bigint not null default 0,
  notes         text,                  -- PII
  created_at    timestamptz not null default now()
);
create index on public.sales (agent_id, sale_date);

create table public.recruiting_logs (
  id            uuid primary key default gen_random_uuid(),
  agent_id      uuid not null references public.agents(id) on delete cascade,
  org_id        uuid not null references public.organizations(id),
  log_date      date not null,
  prospect_name text not null,         -- PII
  source        public.call_source,
  status        public.recruit_status not null default 'contacted',
  notes         text,                  -- PII
  created_at    timestamptz not null default now()
);

-- Targets are set by the SMD, mirroring the workbook's gold cells.
-- agent_id NULL = org-wide default. A row with agent_id set overrides it.
-- effective_from versions the target: a past week is always scored against the
-- target that was live that week, so raising a target never retroactively
-- turns a green week red.
create table public.targets (
  id                uuid primary key default gen_random_uuid(),
  agent_id          uuid references public.agents(id) on delete cascade,
  org_id            uuid not null references public.organizations(id),
  set_by            uuid not null references public.agents(id),
  effective_from    date not null,
  calls_per_week    int not null default 50,
  appts_held_per_week int not null default 3,
  premium_cents_per_week bigint not null default 0,
  min_calls_per_day int not null default 15,
  md_deadline       date
);
-- Postgres treats NULLs as distinct in a UNIQUE constraint, so
-- `unique (org_id, agent_id, effective_from)` would happily allow ten org
-- defaults for the same Monday. Two partial indexes instead:
create unique index targets_org_default_uq on public.targets (org_id, effective_from)
  where agent_id is null;
create unique index targets_agent_uq on public.targets (org_id, agent_id, effective_from)
  where agent_id is not null;
-- Resolution order for an agent-week: agent override → org default → hardcoded
-- fallback (50 / 3 / $188 / 15, the workbook's values). Put this in one
-- function, `private.effective_target(agent_id, week_start)`, and use it
-- everywhere. Never resolve it in two places.

-- READ MODEL. Every dashboard reads this; nothing reads raw logs for metrics.
-- One row per agent per day. 200 agents ≈ 73k rows/year.
-- Wide rather than a separate breakdown table: ~30 ints × 73k rows is a few MB,
-- and every chart on every dashboard then comes from one indexed row per day
-- with no join. Revisit only if the enums start changing often.
create table public.daily_metrics (
  agent_id      uuid not null references public.agents(id) on delete cascade,
  org_id        uuid not null references public.organizations(id),
  activity_date date not null,
  calls_made    int not null default 0,   -- rows in call_logs
  appts_set     int not null default 0,   -- rows created in appointments
  referrals_given int not null default 0,
  recruiting_convos int not null default 0,
  follow_ups_due int not null default 0,     -- fell due on this date
  follow_ups_done int not null default 0,    -- actually called back
  premium_cents bigint not null default 0,
  sales_count   int not null default 0,
  -- Breakdown counts. The donut and bar charts in docs/08-screen-specs.md read
  -- these; without them every chart would have to scan raw logs and the read
  -- model would be bypassed on the very screens it exists to serve.
  out_connected int not null default 0,
  out_voicemail int not null default 0,
  out_no_answer int not null default 0,
  out_appt_set  int not null default 0,
  out_not_interested int not null default 0,
  src_warm_market int not null default 0,
  src_referral  int not null default 0,
  src_cold      int not null default 0,
  src_social_media int not null default 0,
  src_friend    int not null default 0,
  src_other     int not null default 0,
  appt_scheduled int not null default 0,
  appt_held      int not null default 0,
  appt_no_show   int not null default 0,
  appt_rescheduled int not null default 0,
  appt_cancelled   int not null default 0,
  -- NOTE: out_connected IS the connect count, appt_held IS appointments held,
  -- appt_no_show IS the no-show count. Do not add separate `connects`,
  -- `appts_held`, `no_shows` columns — two columns holding the same number is
  -- how they end up disagreeing. RPCs alias these to friendlier output names.
  updated_at    timestamptz not null default now(),
  primary key (agent_id, activity_date)
);
create index on public.daily_metrics (org_id, activity_date);
create index on public.daily_metrics (activity_date);

-- Dirty queue: triggers enqueue, a worker recomputes. See the scale note below
-- for why this beats incremental +1/-1 deltas.
create table private.metrics_dirty (
  agent_id      uuid not null,
  activity_date date not null,
  primary key (agent_id, activity_date)
);

create table public.invitations (
  id         uuid primary key default gen_random_uuid(),
  email      citext not null,
  org_id     uuid not null references public.organizations(id),
  upline_id  uuid not null references public.agents(id) on delete cascade,
  role       public.agent_role not null default 'associate',
  token_hash text not null unique,     -- store sha256, never the raw token
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  created_by uuid not null references public.agents(id)
);

create table public.audit_log (
  id         bigserial primary key,
  actor_id   uuid,
  action     text not null,
  entity     text not null,
  entity_id  text,
  metadata   jsonb not null default '{}',
  created_at timestamptz not null default now()
);
```

---

## Helper functions

```sql
create or replace function private.is_upline_of(target uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.agent_closure c
    where c.ancestor_id = (select auth.uid())
      and c.descendant_id = target
  );
$$;   -- depth 0 row means this is true for self

create or replace function private.my_downline()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select c.descendant_id from public.agent_closure c
  where c.ancestor_id = (select auth.uid());
$$;

create or replace function private.my_org()
returns uuid language sql stable security definer set search_path = '' as $$
  select a.org_id from public.agents a where a.id = (select auth.uid());
$$;

create or replace function private.my_role()
returns public.agent_role language sql stable security definer set search_path = '' as $$
  select a.role from public.agents a where a.id = (select auth.uid());
$$;
```

`private` schema must **not** be listed in Supabase API "Exposed schemas".

---

## RLS policies

Enable on every table: `alter table public.X enable row level security;`

**agents** — you may see yourself and anyone in your downline (name/email/role
only; the table holds no prospect PII).
```sql
create policy agents_select on public.agents for select to authenticated
  using ( (select private.is_upline_of(id)) );
create policy agents_update_self on public.agents for update to authenticated
  using ( id = (select auth.uid()) ) with check ( id = (select auth.uid()) );
```

**RLS is row-level, not column-level — that policy alone lets an associate set
their own `role` to `admin`.** Close it with grants and a guard trigger:

```sql
revoke update on public.agents from authenticated;
grant  update (full_name) on public.agents to authenticated;

create or replace function public.guard_agent_privileged_columns()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (new.role, new.upline_id, new.org_id, new.status)
     is distinct from (old.role, old.upline_id, old.org_id, old.status)
     and coalesce((select a.role from public.agents a
                   where a.id = (select auth.uid())), 'associate') <> 'admin'
  then raise exception 'privileged column change requires admin';
  end if;
  return new;
end $$;
create trigger agents_guard_privileged before update on public.agents
  for each row execute function public.guard_agent_privileged_columns();
```
Role, upline, org, and status changes go only through admin RPCs, which run as
service role and bypass the trigger's caller check by design.

**contacts / call_logs / appointments / sales / recruiting_logs** — owner only,
all four verbs. Identical shape for each:
```sql
create policy calls_own on public.call_logs for all to authenticated
  using ( agent_id = (select auth.uid()) )
  with check ( agent_id = (select auth.uid()) );
```
There is deliberately **no upline SELECT policy** on these tables. `contacts`
is the most sensitive table in the database — it is a list of named people an
agent is working. Nothing but that agent reads it, ever.

`org_id` is set by a `before insert` trigger from the agent's own row, never
from client input, and a `check` constraint in the policy's `with check` clause
asserts `org_id = (select private.my_org())`.

**targets** — an agent reads the ones that apply to them; only a leader or admin
writes, and only inside their own org.
```sql
create policy targets_read on public.targets for select to authenticated
  using ( org_id = (select private.my_org())
          and ( agent_id is null or (select private.is_upline_of(agent_id)) ) );

create policy targets_write on public.targets for insert to authenticated
  with check ( (select private.my_role()) in ('leader','admin')
               and org_id = (select private.my_org())
               and ( agent_id is null or (select private.is_upline_of(agent_id)) ) );

create policy targets_update on public.targets for update to authenticated
  using  ( (select private.my_role()) in ('leader','admin')
           and org_id = (select private.my_org()) )
  with check ( org_id = (select private.my_org()) );
```
Targets are append-effective: changing a target writes a **new row** with
`effective_from` = the coming Monday. Never mutate a past row. Every write lands
in `audit_log` — an SMD lowering a target mid-quarter should be visible.

**daily_metrics** — own rows only, read only. Uplines reach it exclusively
through the aggregate RPCs. Nothing writes to it except the drain function.
```sql
create policy metrics_own on public.daily_metrics for select to authenticated
  using ( agent_id = (select auth.uid()) );
-- no insert/update/delete policy: the drain function is SECURITY DEFINER
```

**private.metrics_dirty** — not in `public`, so it is unreachable via PostgREST.
Belt and braces: `revoke all on private.metrics_dirty from anon, authenticated;`

**invitations** — insert/select restricted to leaders/admins, and `upline_id`
must be inside the caller's own subtree.

**audit_log** — `select` for admin only. No insert/update/delete policy at all;
rows are written by `SECURITY DEFINER` functions.

---

## Aggregate RPCs (the only way a leader reads team data)

All are `security definer`, `stable`, `set search_path = ''`, and every one
begins by filtering to `private.my_downline()`.

```sql
-- Roster: one row per downline agent for the given Monday-start week.
create or replace function public.team_week_summary(p_week_start date)
returns table (
  agent_id uuid, full_name text, depth int,
  calls_made int, appts_set int, appts_held int,
  premium_cents bigint, pct_calls numeric, pct_premium numeric,
  streak_days int, last_logged_at timestamptz
) language sql stable security definer set search_path = '' as $$ ... $$;
```

```sql
-- SMD filter-by-agent, daily grain. Counts only — no name, no note.
create or replace function public.agent_daily_activity(
  p_agent_id uuid, p_from date, p_to date)
returns table (
  activity_date date, calls_made int, appts_set int, appts_held int,
  premium_cents bigint, min_calls_target int, min_met boolean
) language sql stable security definer set search_path = '' as $$ ... $$;
-- first statement must be: if not private.is_upline_of(p_agent_id) then return; end if;

-- Whole-team single day, for "who worked today".
create or replace function public.team_day_summary(p_date date)
returns table (agent_id uuid, full_name text, calls_made int,
               appts_set int, appts_held int, premium_cents bigint)
language sql stable security definer set search_path = '' as $$ ... $$;
```

```sql
-- Powers the "filtered to one agent" view in docs/08-screen-specs.md: the KPI
-- rows, both donuts, the source bar, and the funnel. Counts only.
create or replace function public.agent_aggregate(
  p_agent_id uuid, p_from date, p_to date)
returns table (
  calls_made int, appts_set int, appts_held int, sales_count int,
  premium_cents bigint, referrals_given int, recruiting_convos int,
  out_connected int, out_voicemail int, out_no_answer int,
  out_appt_set int, out_not_interested int,
  src_warm_market int, src_referral int, src_cold int,
  src_social_media int, src_friend int, src_other int,
  appt_scheduled int, appt_held int, appt_no_show int,
  appt_rescheduled int, appt_cancelled int,
  calls_target int, appts_held_target int, premium_cents_target bigint
) language sql stable security definer set search_path = '' as $$ ... $$;
```

Also: `team_trend(p_weeks int)`, `team_inactive(p_days int)`. Both aggregate
`daily_metrics` over `private.my_downline()`.

Every RPC additionally filters `org_id = private.my_org()`, even though the
closure filter already implies it. Two independent checks; a bug must defeat both.

Contract for every RPC: **no column in the return type may be a name, note, or
free-text field.** Enforce it in code review and in a pgTAP test that asserts
the return column list.

---

## Scale: the numbers, and what they mean

**Load at the 200-agent target**

| | per day | per year (250 working days) |
|---|---|---|
| Call rows (200 × 10) | 2,000 | 500,000 |
| Appointment rows (200 × ~2) | 400 | 100,000 |
| Sales + recruiting | ~80 | 20,000 |
| **Raw activity total** | **~2,500** | **~620,000** |
| `daily_metrics` rows | 200 | 73,000 |

At ~200 bytes/row that is roughly **150 MB/year** of activity data. Postgres does
not notice this. **Row count is not the constraint** — do not architect as if it is.

**The actual constraint is the roster query.** Computing the SMD roster straight
from raw logs means, for 200 agents over one week: scan ~17,500 call rows,
~2,800 appointment rows, group by agent, join targets. That is fine at 200 and
unpleasant at 2,000, and it gets re-run on every dashboard load, every filter
change, every poll.

**So: `daily_metrics` is the read model, from day one.** Dashboards never touch
raw logs. The roster for a week becomes 200 agents × 7 rows = 1,400 rows from a
single indexed table. An 8-week trend is 11,200 rows. Both are single-digit
milliseconds and stay that way as raw volume grows, because raw volume no longer
appears in the read path.

**Maintenance: recompute, don't increment.**

```
activity write (insert/update/delete)
   └─ AFTER trigger → upsert (agent_id, date) into private.metrics_dirty
                       (and the OLD date too, on update/delete)
   └─ pg_cron every minute → drain the queue:
        for each dirty (agent, date): DELETE + recompute that one agent-day
        from raw logs (~12 rows), upsert into daily_metrics, clear the queue row
   └─ pg_cron nightly → recompute the last 3 days for all agents (reconcile)
```

Incremental `+1` deltas look cheaper and drift: a deleted row, an edited date, a
failed transaction, and the counter is silently wrong forever with no way to
detect it. Recomputing one agent-day reads about a dozen rows and is idempotent —
run it twice, same answer. The nightly reconcile means any missed trigger
self-heals within 24 hours. Take the correctness.

Latency cost: a logged call appears on the SMD roster within ~60s. If the SMD
wants instant, the agent's *own* dashboard reads raw logs directly for today only
(that agent's own ~10 rows — trivially cheap) and `daily_metrics` for history.
Best of both, and it is the only place raw logs enter a read path.

**Streaks and rolling averages** compute over `daily_metrics` with
`generate_series` for gap-filling. Never over raw logs.

**Scaling path — do not pre-build these**

| Trigger | Action |
|---|---|
| >2,000 agents *or* >5M raw rows | partition `call_logs` and `appointments` by month (`RANGE` on date); `daily_metrics` stays unpartitioned |
| >5,000 agents | move the dirty-queue drain from pg_cron to a Supabase Edge Function on a queue; add a covering index `(org_id, activity_date) INCLUDE (calls_made, appts_held, premium_cents)` |
| Roster p95 >300ms | materialize `weekly_metrics` from `daily_metrics`, same dirty-queue pattern one level up |
| Any | serverless connection churn → use **Supavisor in transaction mode**, not a direct connection. This bites long before row count does. |

Write the phase-1 migration so partitioning is additive: date column always in
the PK-adjacent index, no cross-month unique constraints, no FKs pointing at
activity rows.

**More SMDs is the easy axis.** Each new SMD is one `organizations` row and an
invite. Nothing in the schema changes. The genuine limit on more SMDs is
onboarding, support, and your compliance posture — not the database.

## Migration from the workbook
`POST /api/import` accepts the existing `.xlsx`. Sheet → table mapping is 1:1;
header strings match the tables above. Import idempotency: **do not** key on `(agent_id, date, contact name, outcome)`
— an agent legitimately calls the same person twice in a day with the same
outcome, and that key silently drops the second call. Add a nullable
`import_row_hash text` column to each activity table, set it to
`sha256(file_hash || sheet_name || row_number)`, and make it unique per agent.
Re-uploading the same file is then a no-op; uploading a corrected file with an
extra row imports only that row.
Dry-run preview before commit. Import writes only to `auth.uid()`'s rows,
regardless of what the file contains.
