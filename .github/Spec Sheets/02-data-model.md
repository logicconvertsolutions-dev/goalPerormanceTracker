# Data model, RLS, and RPCs

**Reflects the live schema as of 2026-08-30, reconstructed from all 42
migrations (`p1a` → `p10b`, see `docs/06-build-phases.md`) plus
`types/database.ts`.** Where the shipped schema deviates from the original
P1 design, that's called out inline — the original design decisions below
are still the *reasons* the schema looks this way, even where the specific
columns evolved.

## Design decisions (and why) — still true

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

**Two access tiers, not one.**
- Tier 1 — row access: `agent_id = auth.uid()`. Full row, including PII.
- Tier 2 — aggregate access: upline calls a `SECURITY DEFINER` RPC that returns
  counts and sums. No policy ever grants an upline SELECT on a PII row.

This is the whole security architecture, and it held across P1–P9: `contacts`,
`call_logs`, `appointments`, `sales`, and `recruiting_logs` still carry exactly
one `for all` owner-only policy each, unchanged since P1. Every leak found by
the P9 security pass (see "RLS policies" below) was in the *newer* surfaces
built on top of this core — admin RPCs and `team_roster` — never in the
original tier-1/tier-2 boundary itself.

**Every SECURITY DEFINER function gets `set search_path = ''`** and
fully-qualified names, or it is a privilege-escalation vector via a
search-path-shadowed table. Also true of every RPC added since P1.

---

## Schema (final shape, post-P9)

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
-- CHANGED in p8a: interviewed -> marketing_presented, joined -> recruited,
-- new value 'certified' inserted between recruited and licensed. Renamed via
-- `alter type ... rename value`, so existing rows repointed with no backfill.
create type public.recruit_status as enum
  ('contacted','marketing_presented','recruited','certified','licensed','declined');
-- P10b, backs the `feedback` table (see "Tables not in the original design" below).
create type public.feedback_category as enum ('bug','feature_request','feedback','other');
create type public.feedback_status   as enum ('new','reviewed','resolved');

create table public.organizations (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  owner_id     uuid,                    -- the SMD; FK added after agents exists
  created_at   timestamptz not null default now(),
  -- P6: retention window for the purge job below. NULL disables purging.
  call_log_retention_months int not null default 24,
  -- P7d: /team/organization branding. Signed URL only, private storage bucket.
  logo_path    text
);

create table public.agents (
  id          uuid primary key references auth.users(id) on delete cascade,
  org_id      uuid not null references public.organizations(id) on delete restrict,
  full_name   text not null,
  -- NOT citext, unlike the original design: case-insensitivity is instead a
  -- functional unique index (lower(email)) plus explicit lower() at every
  -- lookup site (handle_new_user, create_invitation).
  email       text not null,
  upline_id   uuid references public.agents(id) on delete set null,
  role        public.agent_role   not null default 'associate',
  status      public.agent_status not null default 'active',
  joined_at   date not null default current_date,
  created_at  timestamptz not null default now(),
  time_zone   text,                     -- P2a: settings, notification send windows
  -- P10a: nullable, backfilled by acceptInvitation() for new agents and by
  -- the one-time /terms/accept gate (requireVerifiedAgent) for everyone else.
  -- `grant update (terms_accepted_at) on public.agents to authenticated`
  -- alongside the existing `full_name` grant -- agents_update_self's RLS
  -- policy (id = auth.uid()) already scopes it.
  terms_accepted_at timestamptz
);
create unique index agents_email_uq on public.agents (lower(email));
create index on public.agents (upline_id);
create index on public.agents (org_id);

-- Hard fence: an upline must live in the same organization. Unchanged since P1.
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

Closure maintenance, triggers, and the cycle guard are unchanged from the
original P1 design across all 40 migrations.

```sql
-- Contacts are PEOPLE, not call rows.
create table public.contacts (
  id         uuid primary key default gen_random_uuid(),
  agent_id   uuid not null references public.agents(id) on delete cascade,
  org_id     uuid not null references public.organizations(id),
  full_name  text not null,            -- PII
  -- `company` shipped in P1, then was DROPPED in p7f — no longer collected
  -- or displayed anywhere in the product.
  -- P9a: phone was deliberately omitted in the original design to keep
  -- PIPEDA surface small ("we do not need them"). Reversed by explicit
  -- product decision once import needed a reliable de-dup key beyond name.
  phone            text,
  phone_normalized text generated always as
    (nullif(regexp_replace(phone, '\D', '', 'g'), '')) stored,
  created_at timestamptz not null default now()
);
create unique index contacts_agent_name_uq on public.contacts (agent_id, lower(full_name));
create unique index contacts_agent_phone_uq on public.contacts (agent_id, phone_normalized)
  where phone_normalized is not null;
create index on public.contacts (agent_id);

create table public.call_logs (
  id           uuid primary key default gen_random_uuid(),
  agent_id     uuid not null references public.agents(id) on delete cascade,
  org_id       uuid not null references public.organizations(id),
  contact_id   uuid not null references public.contacts(id) on delete cascade,
  call_date    date not null default current_date,
  follow_up_on date,
  follow_up_done_at timestamptz,
  source       public.call_source  not null,
  outcome      public.call_outcome not null,
  notes        text,                   -- PII
  -- Spreadsheet-import dedup key: sha256(file_hash || sheet_name || row_number).
  import_row_hash    text,
  -- P3n: offline-queue idempotency. Client-generated UUID per logged action,
  -- so a retried submit after a dropped connection doesn't double-insert.
  -- Distinct mechanism from import_row_hash — insert plain and treat a
  -- unique-violation (23505) as "already saved"; never upsert against a
  -- partial index, Postgres rejects that.
  client_request_id  text,
  created_at   timestamptz not null default now()
);
create index on public.call_logs (agent_id, call_date);
create index on public.call_logs (org_id);
create index on public.call_logs (agent_id, follow_up_on)
  where follow_up_on is not null and follow_up_done_at is null;
create unique index call_logs_import_uq on public.call_logs (agent_id, import_row_hash)
  where import_row_hash is not null;
create unique index call_logs_client_req_uq on public.call_logs (agent_id, client_request_id)
  where client_request_id is not null;

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
  -- P7f: appointments can carry their own follow-up, mirroring call_logs.
  follow_up_on       date,
  follow_up_done_at  timestamptz,
  import_row_hash    text,
  client_request_id  text,
  created_at       timestamptz not null default now()
);
create index on public.appointments (agent_id, appt_date);
create index on public.appointments (org_id);
create index appointments_followup_idx on public.appointments (agent_id, follow_up_on)
  where follow_up_on is not null and follow_up_done_at is null;
create unique index appointments_import_uq on public.appointments (agent_id, import_row_hash)
  where import_row_hash is not null;
create unique index appointments_client_req_uq on public.appointments (agent_id, client_request_id)
  where client_request_id is not null;

-- NEVER SHIPPED: the original design's `client_name text not null`. Sales
-- link to an existing contact/appointment instead of duplicating a free-text
-- name.
create table public.sales (
  id            uuid primary key default gen_random_uuid(),
  agent_id      uuid not null references public.agents(id) on delete cascade,
  org_id        uuid not null references public.organizations(id),
  contact_id     uuid references public.contacts(id) on delete set null,
  appointment_id uuid references public.appointments(id) on delete set null,
  sale_date     date not null,
  product_type  text,
  premium_cents bigint not null default 0,
  notes         text,                  -- PII
  follow_up_on       date,             -- P7f
  follow_up_done_at  timestamptz,
  import_row_hash    text,
  client_request_id  text,
  created_at    timestamptz not null default now()
);
create index on public.sales (agent_id, sale_date);
create index on public.sales (org_id);
create index sales_followup_idx on public.sales (agent_id, follow_up_on)
  where follow_up_on is not null and follow_up_done_at is null;
create unique index sales_import_uq on public.sales (agent_id, import_row_hash)
  where import_row_hash is not null;
create unique index sales_client_req_uq on public.sales (agent_id, client_request_id)
  where client_request_id is not null;

-- NEVER SHIPPED: `prospect_name text not null`. Links to contacts instead,
-- same rationale as sales above.
create table public.recruiting_logs (
  id            uuid primary key default gen_random_uuid(),
  agent_id      uuid not null references public.agents(id) on delete cascade,
  org_id        uuid not null references public.organizations(id),
  contact_id    uuid references public.contacts(id) on delete set null,
  log_date      date not null default current_date,
  source        public.call_source,
  status        public.recruit_status not null default 'contacted',
  notes         text,                  -- PII
  import_row_hash    text,
  client_request_id  text,
  created_at    timestamptz not null default now()
);

create table public.targets (
  id                uuid primary key default gen_random_uuid(),
  agent_id          uuid references public.agents(id) on delete cascade,
  org_id            uuid not null references public.organizations(id),
  -- Nullable (was `not null` in the original design) to allow the org-default
  -- row created during provision_org(), which precedes any agent existing.
  set_by            uuid references public.agents(id),
  effective_from    date not null,
  calls_per_week    int not null default 50,
  appts_held_per_week int not null default 3,
  premium_cents_per_week bigint not null default 18800,  -- workbook's $188/wk
  min_calls_per_day int not null default 15,
  md_deadline       date,
  created_at        timestamptz not null default now()
);
create unique index targets_org_default_uq on public.targets (org_id, effective_from)
  where agent_id is null;
create unique index targets_agent_uq on public.targets (org_id, agent_id, effective_from)
  where agent_id is not null;
-- Resolution unchanged: private.effective_target(agent_id, week_start).

create table public.daily_metrics (
  agent_id      uuid not null references public.agents(id) on delete cascade,
  org_id        uuid not null references public.organizations(id),
  activity_date date not null,
  calls_made    int not null default 0,
  appts_set     int not null default 0,
  referrals_given int not null default 0,
  recruiting_convos int not null default 0,
  follow_ups_due int not null default 0,
  follow_ups_done int not null default 0,
  premium_cents bigint not null default 0,
  sales_count   int not null default 0,
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
  updated_at    timestamptz not null default now(),
  primary key (agent_id, activity_date)
);
create index on public.daily_metrics (org_id, activity_date);
create index on public.daily_metrics (activity_date);
-- No structural change across all 40 migrations — only the drain/recompute
-- function evolved. This table is exactly as load-bearing as the original
-- design intended: every dashboard reads it, nothing reads raw logs for
-- metrics except an agent's own numbers for today.

create table private.metrics_dirty (
  agent_id      uuid not null,
  activity_date date not null,
  primary key (agent_id, activity_date)
);

create table public.invitations (
  id         uuid primary key default gen_random_uuid(),
  email      citext not null,
  org_id     uuid not null references public.organizations(id),
  upline_id  uuid references public.agents(id) on delete cascade,   -- nullable: SMD bootstrap
  role       public.agent_role not null default 'associate',
  token_hash text not null unique,
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  revoked_at  timestamptz,             -- new: /team/invites Revoke action
  created_by uuid references public.agents(id)   -- nullable: SMD bootstrap
);

create table public.audit_log (
  id         bigserial primary key,
  actor_id   uuid,
  org_id     uuid,        -- new: lets a leader's org-scoped audit read work
  action     text not null,
  entity     text not null,
  entity_id  text,
  metadata   jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index on public.audit_log (org_id, created_at desc);
```

### Tables not in the original design

Added over P2–P10, none anticipated by the original P1 schema:

- **`notification_prefs`** (P2a) — one row per agent, three booleans
  (`evening_nudge`, `sunday_summary`, `monday_digest`), all default `true`.
  Owner-only `for all` RLS.
- **`mfa_recovery_codes`** (P2a) — `agent_id`, `code_hash`, `used_at`. Owner
  **select-only** RLS; enrollment/redemption writes go through the
  service-role client, never a client-writable policy.
- **`agent_nudges`** (P5a, restructured P9f) — single row per agent
  (`agent_id` is the PK), `last_sent_at`, `last_sent_by`. Started as an
  append-only send log; P9f collapsed it to one row per agent so the 7-day
  cooldown can be enforced atomically (see "Security-fix migrations" below).
  No RLS policies at all — reachable only via `nudge_agent()`.
- **`notification_log`** (P5.5) — one row per `(agent_id, kind, local_date)`,
  unique-constrained. The unique index *is* the daily rate limit: the cron
  route inserts before sending, so two concurrent cron runs can't double-send.
- **`team_roster`** (P9b) — a new tier *before* an invitation: an SMD can list
  a prospective team member (name/email/phone/notes) with no `auth.users` or
  `agents` row yet. Carries `upline_id`, optionally links to an `invitations`
  row once one is sent, plus `last_training_reminder_at` (P9c).
- **`agent_training_reminders`** (P9b, restructured P9f) — same
  single-row-per-agent shape as `agent_nudges`, for reminding an
  already-onboarded agent to complete training.
- **`private.rate_limits`** (P6e) — general-purpose fixed-window counter
  (`rl_key`, `window_start`, `count`) backing `check_rate_limit()`. Keys off
  `auth.uid()`, never a client-supplied id. `revoke all from anon, authenticated`.
- **`feedback`** (P10b) — bug/issue/feature reports submitted from the
  account menu (`/feedback`). `category` (`bug | feature_request | feedback |
  other`) and `status` (`new | reviewed | resolved`) enums, `org_id` set by
  the same `set_org_from_agent()` trigger every owner-scoped table uses.
  Owner insert/select-own, plus an **admin-global** select and a
  status-only admin update (`/admin/feedback`) — same shape as
  `agents_admin_read`/`audit_admin_read`, since a feedback report is
  operational text an agent chose to submit, not prospect PII.

---

## Helper functions — unchanged since P1

```sql
create or replace function private.is_upline_of(target uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.agent_closure c
    where c.ancestor_id = (select auth.uid())
      and c.descendant_id = target
  );
$$;

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

Plus, added since P1: `private.effective_target()` (target resolution, as
originally specced), `private.mark_dirty()` / `private.recompute_day()` (the
metrics pipeline internals), `private.purge_old_call_logs()` (P6 retention),
and `private.team_week_summary_for()` (P5.5, the cron-callable variant of
`team_week_summary` parameterized by an explicit leader id since the cron job
has no `auth.uid()` session).

`private` schema must **not** be listed in Supabase API "Exposed schemas".

---

## RLS policies (final state)

Enable on every table: `alter table public.X enable row level security;` —
true of every table listed above, including every one added since P1.

**agents** — unchanged shape: self + downline, name/email/role/status only.
Added since P1: `agents_admin_read` (P6d) — global select for `role = 'admin'`,
powering `/admin/agents`, with no org filter by design (that's the point of
being admin).

The column-level protection (`revoke update`, `grant update (full_name)`,
the `guard_agent_privileged_columns` trigger) is unchanged in principle, but
the trigger gained one exception in **P6a**: role/upline/org/status changes
made by an already-vetted SECURITY DEFINER function (`deactivate_agent()`,
`delete_my_account()`) set a transaction-scoped flag
(`set_config('app.privileged_agent_write', 'on', true)`) immediately before
writing, so the trigger doesn't block a write that a different authorization
path already approved. This closed a real bug where a leader's own
`deactivate_agent()` call was rejected by the trigger, because the trigger
only ever checked whether the *caller* was admin, not whether a vetted
function had already done the authorization.

**contacts / call_logs / appointments / sales / recruiting_logs** — **one
`for all` owner-only policy each, unchanged since P1 across all 40
migrations.** This remains the core guarantee: no policy on any of these five
tables has ever granted an upline SELECT. `org_id` is set by a
`before insert or update of agent_id` trigger from the owning agent's row,
never client input.

**targets** — unchanged since P1.

**daily_metrics** — unchanged since P1: own rows, select only, no
insert/update/delete policy (writes only via the drain function).

**invitations** — unchanged since P1.

**audit_log** — the original single admin-only SELECT policy is now two:
`audit_admin_read` (global, admin) and `audit_leader_read` (P6d, org-scoped,
`role = 'leader'`) — the latter powers `/team/audit`. Still no
insert/update/delete policy at all; rows are written exclusively by
`SECURITY DEFINER` functions and triggers.

**team_roster** (P9b) — role + own-org read/insert, all correctly gated by
`is_upline_of(upline_id)` from the start on insert. **The update and delete
policies did not carry that same `is_upline_of` check when first shipped —
see the security-fix section below.**

**organizations** (P7d) — an org-scoped select plus an admin-global select
(P6d); update restricted by role + own-org, with column grants limiting
`authenticated` to `name`/`logo_path` only.

### Security-fix migrations, precisely

These three migrations are the reason this file needed a rewrite in the
first place — the original spec's threat model in `docs/04-security.md` was
written before any of this existed, so it's the authoritative narrative for
what actually went wrong. Full technical detail lives there; summarized here
because it's schema/RLS-level:

**P9d — cross-tenant IDOR in admin lifecycle RPCs.** `admin_move_agent`,
`admin_reactivate_agent`, `admin_hard_delete_agent`, and
`admin_set_agent_role` are `service_role`-only — authorization happened
entirely in the calling Server Action, which checked the actor was an admin
of *some* org but never that the **target** agent belonged to the **actor's**
org. Any admin could act on any agent in either organization. Fixed by adding
an explicit org-match check inside each function, raising a
non-distinguishing `'agent not found'` on mismatch.

**P9e — in-org roster scope leak.** `team_roster_update`/`_delete` policies
and `send_roster_training_reminder()` checked role + org but not
`is_upline_of(upline_id)`, unlike their sibling insert policy and the other
nudge/reminder RPCs. Any leader/admin in an org could edit or delete another
leader's roster entries. Fixed by adding the missing `is_upline_of` check to
both policies and the RPC.

**P9f — TOCTOU race in the 7-day cooldown.** `nudge_agent()` and
`send_training_reminder()` used a non-atomic check-then-insert for their
rate limit; two concurrent calls could both pass the check before either
write committed, sending two notifications inside one cooldown window. Fixed
by restructuring `agent_nudges`/`agent_training_reminders` into
single-row-per-agent trackers and using
`insert ... on conflict (agent_id) do update ... where last_sent_at <= now() - interval '7 days'`
— the `where` clause on the conflict update **is** the atomic rate-limit
check.

**Not a migration — the "admin MFA bypass" fix (commit `7bad83a`).**
Application-layer, not RLS: `requireAdmin()` checked role but not
`session.mfaVerified`, so a password-only admin session (MFA not yet
completed) could reach the full admin surface. The same gap existed
independently in two hand-rolled guards on `/admin/agents` and `/admin/orgs`
that call the service-role client directly. All three now require
`mfaVerified` explicitly. Full detail in `docs/04-security.md`.

---

## Aggregate RPCs (the only way a leader reads team data)

All are `security definer`, `stable`, `set search_path = ''`, granted only to
the roles that call them, and every one begins by filtering to
`private.my_downline()` and/or `is_upline_of()`.

**Unchanged from the original four:** `team_week_summary`,
`agent_daily_activity`, `team_day_summary`, `agent_aggregate`, `team_trend`,
`team_inactive` — signatures match the original design, with `team_trend`
gaining an optional `p_agent_ids uuid[]` filter (P5e) so the "filtered to one
agent" view and multi-select both reuse the same RPC.

**Added since P1:**
- `team_period_summary(p_from date, p_to date)` (P7c) — generalizes
  `team_week_summary` to an arbitrary range, scaling per-agent weekly targets
  proportionally so non-week filters ("This Month", "Last 30 Days") compare
  against a fair target instead of one week's number.
- `team_breakdown(p_from date, p_to date, p_agent_ids uuid[])` (P5a, agent
  filter added P5d) — team-wide donut/bar breakdown, same shape as
  `agent_aggregate`'s breakdown columns.
- `agent_daily_breakdown(p_from date, p_to date, p_agent_ids uuid[])` (P7e)
  — powers the "Daily" activity table, zero-filled per day via
  `generate_series`.
- `team_target(p_agent_id uuid, p_week date)` / `my_target(p_week date)`
  (P5a / P2a) — `effective_target` wrappers for the SMD drill-down and an
  agent's own settings card, respectively.
- `my_followups(p_as_of date)` (P1i, bug fixed P2c, `company` column dropped
  P7f) — the agent's own `/today` queue.
- `admin_daily_active_loggers(p_days int)` (P7a) — the pilot instrument
  behind `/admin/pilot`; cross-joins active agents with the last N business
  days and flags whether anything was logged.

Contract unchanged: **no column in any return type may be a name, note, or
free-text field.** Still enforced by the return-shape pgTAP assertion in
`docs/05-testing.md`.

### EXECUTE lockdown

Unchanged principle since P1l: Postgres grants `EXECUTE` to `PUBLIC` by
default on function creation, so every migration since has explicitly
`revoke`d and re-granted only to the specific role that should call it.
`service_role`-only functions (the admin lifecycle RPCs, the notification
system wrappers) are never granted to `authenticated`/`anon` at all — they're
reachable only through the service-role client from a Server Action that has
already performed its own upstream check. This is exactly the shape of gap
P9d closed: the RPC itself was correctly locked to `service_role`, but the
upstream check that gated *which* Server Action call was allowed didn't scope
by org.

---

## Scale: the numbers, and what they mean

Unchanged from the original design — the 200-agent target, the
`daily_metrics` read-model rationale, and the scaling triggers table are all
still accurate. See the original reasoning below; nothing about the pipeline
architecture changed across P1–P9.

**Load at the 200-agent target**

| | per day | per year (250 working days) |
|---|---|---|
| Call rows (200 × 10) | 2,000 | 500,000 |
| Appointment rows (200 × ~2) | 400 | 100,000 |
| Sales + recruiting | ~80 | 20,000 |
| **Raw activity total** | **~2,500** | **~620,000** |
| `daily_metrics` rows | 200 | 73,000 |

**The actual constraint is the roster query**, not row count — see the read
model rationale above. `daily_metrics` from day one; dashboards never touch
raw logs.

**Maintenance: recompute, don't increment — still the live mechanism.**
The pg_cron pipeline is unchanged across all 40 migrations:

```
activity write (insert/update/delete)
   └─ AFTER trigger (enqueue_metrics) → upsert (agent_id, date) into private.metrics_dirty
   └─ pg_cron `drain-metrics`, every minute → public.drain_metrics(1000):
        for each dirty (agent, date): DELETE + recompute via private.recompute_day,
        upsert into daily_metrics, clear the queue row
   └─ pg_cron `reconcile-metrics`, nightly (03:15) → re-mark the last 3 days
        dirty for every agent (self-heals any missed trigger)
   └─ pg_cron `purge-old-call-logs`, nightly (03:30, P6) → private.purge_old_call_logs():
        deletes call_logs older than the org's call_log_retention_months
        (default 24, NULL disables), skipping any row whose contact has a sale
```

**One correction to the original spec's automation story:** the notifications
cron (evening nudge / Sunday summary / Monday digest — a *different*
pipeline, unrelated to `daily_metrics`) moved from Vercel Cron to a GitHub
Actions workflow (`.github/workflows/notifications-cron.yml`, every 15
minutes) because Vercel's Hobby plan only allows once-daily schedules and the
notification send-window logic needs a 15-minute cadence to catch every
agent's local time zone. **This move is scoped entirely to the notifications
route.** The three `daily_metrics`/retention cron jobs above are still
pg_cron jobs living inside Postgres, exactly as originally designed.

**Scaling path — do not pre-build these.** Unchanged from the original
design; see `docs/06-build-phases.md` for current scale in practice.

## Migration from the workbook

`import_row_hash` (spreadsheet import dedup) and `client_request_id` (P3n,
offline-queue retry idempotency) are two **distinct** partial-unique-index
mechanisms on every activity table — don't conflate them. Import is a
Server Action, not a literal `/api/import` HTTP route (there isn't one);
rate-limited via `check_rate_limit()` (P6e). See `docs/08-screen-specs.md`
for what the import UI actually looks like now (native contact import with
downloadable templates, not just a bare `.xlsx` upload) — that's grown
well beyond this file's original one-paragraph description.
