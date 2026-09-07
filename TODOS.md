# TODOs

Design debt and deferred work surfaced by review. Newest first.

## 2026-09-07 — RESOLVED (with a follow-up): staging dashboard showed zero numbers despite activity being logged correctly

**What:** SMD-reported during staging testing: logging calls/appointments/
sales/recruiting conversations worked, but both the personal dashboard and
team dashboard stayed at zero. Root cause: `pg_cron` and `pg_net` were never
actually enabled on the `staging` branch (confirmed via `list_extensions` --
`installed_version: null` for both, versus both installed on production).
Same failure class as the pgmq/auth-trigger gaps from 2026-09-06 above, one
level deeper: `pg_dump` (what the baseline was built from) only captures
schema objects, and neither an extension enabled via the Dashboard UI nor a
`cron.schedule(...)` call (a plain INSERT into `cron.job` -- data, not DDL)
is a schema object. So every one of the six pg_cron jobs this app depends on
(`drain-metrics`, `reconcile-metrics`, `purge-old-call-logs`,
`enqueue-due-notifications`, `ping-notification-drain`,
`ping-legacy-notifications`) silently didn't exist on `staging`. The
`enqueue_metrics` trigger (schema, so present on every branch) was correctly
marking `private.metrics_dirty` on every activity write the whole time --
nothing was ever draining it into `public.daily_metrics`, which is the only
thing dashboards read (CLAUDE.md rule 10).

**Resolution:** `supabase/migrations/20260907140000_p20c_pg_cron_jobs.sql`
-- `CREATE EXTENSION IF NOT EXISTS` for both, then re-registers all six
`cron.schedule(...)` calls (idempotent -- pg_cron upserts by job name).
Merged dev -> staging, applied via the git-linked branch's auto-migration on
push, confirmed via `list_migrations` (not the branch status field).
`drain-metrics` running every minute catches up on whatever's already queued
in `metrics_dirty` within a minute of the migration landing -- no backfill
step needed.

**Still open (cross-references item #3 in the 2026-09-06 entry above,
unresolved since then):** the three notification jobs
(`enqueue-due-notifications`, `ping-notification-drain`,
`ping-legacy-notifications`) are now scheduled but still no-op on `staging`
until the `app_base_url`/`cron_secret` Vault secrets exist for this branch
(`private.ping_app_route()`'s own guard, `raise notice` instead of erroring)
-- doesn't block dashboards/metrics, only notification emails.

## 2026-09-06 — RESOLVED (with follow-ups): rebuilt `staging` Supabase branch after repeated migration/encoding failures; production migration pipeline was briefly stuck

**What:** The persistent `staging` Supabase branch failed to build correctly
five separate times in one session — missing `private` schema, missing
`auth.users` trigger, missing `pgmq` extension, an unguarded identity-column
`ALTER` colliding on re-run, two unguarded `PRIMARY KEY` constraints, two
unguarded `CREATE INDEX` statements, a latent `anon`/`authenticated`
privilege leak across 20 functions + 5 tables (beyond the 4 pgTAP happened to
catch), a UTF-8 BOM breaking `psql` twice, and the branch itself getting
deleted once by "Automatic branching" PR-preview cleanup and rebuilt empty
once by a dashboard "reset" that didn't actually re-run migrations.

**Why it matters:** Two of these (the identity-column collision, the BOM)
briefly left **production's own migration pipeline stuck** (`MIGRATIONS_FAILED`
status, would have kept re-failing on every future push to `master` until
fixed) — not just a staging inconvenience.

**Resolution:** All root causes fixed and merged to `master`+`staging`:
- `00000000000002_auth_user_trigger.sql` — the missing trigger
- `00000000000003_pgmq_schema.sql` — pgmq extension + guarded identity/constraint/index statements
- `00000000000004_explicit_role_revokes.sql` — expanded to all 24 service-role-only functions and 6 no-RLS tables, not just the original 4+1
- `staging` recreated via `supabase branches create staging --persistent` (CLI, not dashboard — see CLAUDE.md's new "Known gotchas" section), linked to the `staging` git branch, verified via direct table/migration-history queries (not the dashboard status field, which was misleading twice)
- Automatic Branching turned off in the Supabase-GitHub integration settings
- New `CLAUDE.md` section added ("Known gotchas — Supabase branching & migrations") capturing every mechanism above so it doesn't get rediscovered from scratch next session

**Still open — do these before resuming feature work:**
1. **Rebuild `staging`'s test data from scratch.** The bootstrapped admin
   account, MFA enrollment, and everything downstream were lost twice along
   with the branch. Bootstrap flow (this app has no open signup — see
   `handle_new_user`'s `invitations` requirement):
   - Insert an admin invitation directly via SQL (`token_hash =
     encode(digest(token, 'sha256'), 'hex')`, matching `provision_org`'s own
     scheme) since there's no existing admin to invite the first one
   - Complete signup at `/invite/<token>`, enroll real TOTP MFA (can't be
     faked — `mfaVerified` requires actual `aal2`)
   - Use `/admin/orgs` to provision an org + first leader (real invite flow,
     real email)
   - Leader invites associates through the app's own team/invites screen
2. **Verify Vercel's `staging`-scoped env vars.** The Supabase project ref
   for `staging` changed three times this session (most recently
   `zfcgxmzzviskgyjcovtd`). `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` almost
   certainly still point at an old, now-deleted branch until manually
   updated and redeployed.
3. **`RESEND_API_KEY`, `NOTIFICATIONS_UNSUB_SECRET`, `CRON_SECRET`
   (staging-scoped)** were set up earlier in the session against a prior
   `staging` branch — re-verify they still make sense against the current
   one, especially `CRON_SECRET`'s Supabase Vault half (`Settings → Vault →
   cron_secret` on the branch itself, separate from the Vercel env var).

**Context:** This surfaced during an otherwise-unrelated attempt to run the
original 8-point manual/security/load testing plan — none of that plan has
actually started yet; all of today's work was environment/infrastructure
prerequisite work.

## 2026-09-06 — RESOLVED: full audit of every save path for the "duplicate key" bug class, two real bugs found and fixed

**Trigger:** after the targets_audit trigger fix below, saving a Goal
started failing with `duplicate key value violates unique constraint
"targets_org_default_uq"`. Root cause: `setTargetAction` has always done a
plain `.insert()` into `public.targets` (unchanged since P5's original
implementation), and `effective_from` is always "the start of the next
period" — saving a goal twice before that boundary is reached recomputes
the *same* `effective_from` and collides with `targets_org_default_uq`/
`targets_agent_uq`. **Not a regression from the cycle-cadence work** —
`nextMonday()` had the identical collision any time an SMD adjusted a
pending goal twice in one week; it just hadn't been hit until now.

**Fix:** added `public.set_target()` (`20260906140000_p19d_set_target_upsert.sql`),
an atomic `INSERT ... ON CONFLICT ... WHERE ... DO UPDATE` RPC — a plain
`.upsert()` can't target these indexes since they're partial (`where
agent_id is [not] null`), which `on_conflict=columns` has no way to
express. A row whose `effective_from` hasn't been reached yet has never
scored anything (CLAUDE.md rule 8 protects past rows, not future ones), so
correcting a still-pending goal in place is correct, not a rule violation.
`setTargetAction` now calls this RPC instead of inserting directly.
Verified live: two saves in a row now update the same pending row (1 row,
latest value wins) for both the org default and a per-agent override, and
a non-leader/out-of-downline caller is still rejected.

**Given the user then asked for "a thorough review on all savings,"** I
audited every Server Action `.insert()`/`.upsert()` call in the app
against every unique constraint in the schema, looking specifically for
this same class of bug: a legitimate double-submit hitting an unhandled
unique-violation. Found one more:

`findOrCreateContact()` (`src/lib/contacts.ts`) does a plain
SELECT-then-INSERT with no locking between them. Two requests for the same
brand-new contact name (a double-click, a retry) can both pass the "no
existing row" lookup, then both insert — the loser hits
`contacts_agent_name_uq (agent_id, lower(full_name))` and the whole save
was lost, even though the contact now legitimately exists via the other
request. Shared by every activity-logging action (log/sales/appointments/
recruiting) and the manual "Add contact" action. Fixed by catching `23505`
and re-running the same by-name lookup to return the winning row, instead
of failing — the same spirit as this codebase's existing
`client_request_id`/`import_row_hash` unique-violation handling. Its bulk
sibling, `resolveContactsBulk()` in `src/lib/import/commit-import.ts`, had
the identical gap (no `23505` handling at all, unlike `commitActivityRows`
a few lines above it in the same file, which already falls back to
per-row inserts on conflict) — fixed with the same per-row
fallback-and-relookup pattern.

**Everything else audited came back clean:** `call_logs`/`appointments`/
`sales`/`recruiting_logs` inserts already correctly absorb a
`client_request_id`/`import_row_hash` unique-violation as "already saved."
`notification_prefs` and `announcement_dismissals` already use `.upsert()`
correctly (primary-key/explicit-`onConflict` arbiters, not partial
indexes). Every table without a unique constraint (`feedback`,
`team_roster`, `agent_email_changes`, `mfa_recovery_codes`, `audit_log`) has
nothing to collide with. `invitations`/`admin/orgs`/`admin/announcements`/
`admin/feedback` do all their writes through RPCs, not raw
`.insert()`/`.upsert()`, so any unique-constraint handling there
(`invitations.token_hash`) lives inside that SQL — not audited in this
pass since it wasn't the reported symptom, worth a follow-up if a similar
report ever comes in from that surface.

**Verified:** `tsc --noEmit` clean, full `vitest run` green (60 tests, no
regressions in existing `commit-import.test.ts` coverage — the fixes only
add new error branches), both DB-level fixes exercised directly against
the live Supabase project (repeated `set_target` calls confirmed to update
in place; the `contacts_agent_name_uq` collision confirmed to raise
exactly the error code the new catch branch checks for).

## 2026-09-06 — RESOLVED: targets_audit trigger still referenced calls_per_week, breaking every Goals save

**What:** Right after the three bugs below were fixed, saving a Goal (org
default or per-agent override) started failing with `record "new" has no
field "calls_per_week"`. Root cause: `public.audit_target_change()` — the
`targets_audit` trigger from `20260818132848_p1j_invite_only_signup.sql` —
built its `audit_log` metadata with `new.calls_per_week` directly off the
`NEW` row. P17a renamed that column to `calls_per_cycle`; since a trigger
reads the base table row rather than going through `effective_target`'s
return shape, it wasn't caught by P19a's sweep of `team_period_summary` and
its siblings. Every insert or update on `public.targets` had been failing
outright since P17a shipped.

**Fix:** `20260906130000_p19c_fix_audit_target_change_cycle_column.sql`
updates the column reference, applied to the live project. Verified with a
rolled-back test insert (`insert into public.targets (...)`) — succeeds,
and `audit_log` records the correct `calls` value. Also queried
`pg_proc.prosrc` directly across `public`/`private` for any other function
still containing `calls_per_week`/`appts_held_per_week`/
`premium_cents_per_week` — `audit_target_change` was the only one left.

**Lesson for next rename-shaped migration:** P17b's review scope was "who
else selects from `effective_target`'s return shape" — correct for every
RPC that resolves a target through that function, but `audit_target_change`
reads `public.targets`' own columns directly off the trigger's `NEW` row,
never going through `effective_target` at all, so it fell outside that
scope entirely. The reliable check after any column rename is a direct
`pg_proc.prosrc` search across the live database for the old column name
(as done here) — that catches every consumer regardless of which table or
function it touches, not just the ones downstream of the specific function
being changed.

## 2026-09-06 — RESOLVED: three more P17-era bugs found and fixed (My Team empty, missing Organization/Members nav, leader notification toggles)

Follow-up to the same-day P15-P18 rollout below — three more user reports,
all downstream of P17's targets-per-cycle rename or a UI gap it exposed.

**1. My Team dashboard showed empty for leaders with real downlines.**
`public.team_period_summary` (the RPC `/team`, `/team/targets`, and the CSV
export all call) still selected `calls_per_week`/`appts_held_per_week`/
`premium_cents_per_week` from `private.effective_target`'s return row.
P17a renamed those columns to `*_per_cycle`, and P17b updated every other
consumer (`private.team_period_summary_for`, `agent_daily_activity`,
`team_trend`) but missed this one — its own P17b migration header even says
the intent was to move onto "the already-generalized
`team_period_summary(p_from, p_to)`," apparently mistaking it for already
fixed. Every call raised `42703` (column does not exist); `/team/page.tsx`
only reads `{ data }` from the RPC result, not `error`, so the failure
silently rendered as "No one in your downline yet" regardless of actual
team size. Fixed in
`20260906120000_p19a_fix_team_period_summary_cycle_columns.sql` (renamed
the columns, switched the weekly scaling factor to the 10-day cycle divisor
already used by `team_period_summary_for`), applied to the live project and
verified against real seed data (`Sample SMD`'s 2-associate downline
resolved correctly with no error).

**2. When My Team was empty, the SMD couldn't reach Organization/Goals/
Invites/Members at all.** Those four buttons lived only in `/team/page.tsx`'s
non-empty return branch; the empty-roster branch returned early with just a
bare "invite someone" link, no way to navigate anywhere else from `/team`.
This made bug #1 worse (a leader hitting the bugged empty state was fully
stranded) but is also a real gap on its own for a leader with a genuinely
empty downline, who still needs Organization/Members to manage the org.
Fixed by hoisting the nav button row into a shared block rendered on both
the empty and non-empty paths.

**3. Settings was missing "Evening nudge"/"Cycle summary" for leaders —
by design, then changed by product decision.** `private.
enqueue_due_notifications()` only ever queued those two kinds for
`role = 'associate'`; `notification-toggles.tsx`'s `ROWS_BY_ROLE` correctly
hid the toggles from leaders since showing a control with no effect would
have been misleading. This was working as originally designed (P14d), not
a bug — confirmed with the user, who decided leaders should now receive all
three notification kinds, since a leader logs their own activity and has
their own Goals/streak just like an associate. Widened in
`20260906121000_p19b_leader_personal_notifications.sql` (`n.role in
('associate', 'leader')` for `evening_nudge`/`sunday_summary`; `admin`
deliberately excluded — no org, no activity, no target, nothing to nudge
about). `notification-toggles.tsx` now shows leaders all three toggles;
`compose.ts`/`window.ts`/`window.test.ts` doc comments and `Spec Sheets/
09-account-and-auth.md` updated to match (the latter also corrected a
stale reference to a `roleAllows()` helper that was never actually in the
codebase — the real mechanism is the SQL `n.role in (...)` predicates
inline in `enqueue_due_notifications()`).

**Verified:** `tsc --noEmit` clean (same pre-existing xlsx-stub-only
failures as every prior session, unrelated to this change), `vitest run`
green (60 tests, including all `window.test.ts` cases), and #1's SQL fix
re-run directly against the live database with a real leader's downline to
confirm the column-name fix actually resolves. Not covered: no pgTAP run
(same "no local/CI Supabase instance in this sandbox" gap as every other
entry below) — worth adding a `team_period_summary` regression case run
directly against a leader with `daily_metrics` rows so this class of "RPC
consumer missed by a rename" bug gets caught by `supabase test db` next
time, not by a user report.

## 2026-09-06 — RESOLVED: P15-P18 migrations applied to the live Supabase project (were never deployed, causing the Dashboard-target and Settings-save bugs)

**What happened:** The P15-P18 migrations (call-source additions, the
10-day-cycle date helpers, the Goals-per-cycle rename, and the
notification-cadence change) had been written and committed across prior
sessions but — because this sandbox has no local Supabase/Docker instance —
were only ever verified with `tsc --noEmit` and `vitest run`, never applied
to an actual Postgres database. They sat unapplied on the live project
while the application code was already written against the new
schema/RPC shapes. Two user-reported bugs were the direct symptom:
Settings → org defaults failed to save with `Could not find the
'appts_held_per_cycle' column of 'targets' in the schema cache`, and the
Dashboard showed calls made with no target because `my_target` was called
with the new `p_period_start` argument name against the live DB's still-old
`my_target(p_week date)`. Diagnosed directly via `mcp__Supabase__
list_migrations`/`list_tables` against the live project (id
`arswptuybizvceabecyn`), confirmed with the user, then fixed by applying
all 6 pending migrations directly to the live database in dependency order:
`p15a_call_source_existing_client_recruit`,
`p15b_call_source_existing_client_recruit_functions`,
`p16a_cycle_date_helpers`, `p17a_targets_per_cycle`,
`p17b_retire_week_hardcoded_roster_rpcs`,
`p18a_notification_cycle_cadence`.

**Bug found and fixed during rollout:** `p17a_targets_per_cycle.sql`'s
in-repo claim that renaming `RETURNS TABLE` output columns doesn't require
`drop function` was wrong — Postgres raised `42P13: cannot change return
type of existing function` for `private.effective_target`, `public.
my_target`, `public.team_target`, and `public.system_effective_target`
(their OUT-column names changed even though the `(uuid, date)` argument
signature didn't). Fixed by adding `drop function if exists ...` before
each `create or replace` in the migration file itself (commit `7b2551b`),
matching the pattern P15b already used correctly for `agent_aggregate`/
`team_breakdown`. All other migrations in the batch applied clean on the
first try.

**Verified after applying:** `list_tables` confirms `public.targets` now
has `calls_per_cycle`/`appts_held_per_cycle`/`premium_cents_per_cycle`;
`mcp__Supabase__generate_typescript_types` against the live schema diffs
against the hand-synced `types/database.ts` with only a key-ordering
difference (`cycle_start`/`cycle_end` function entries) — no actual type
mismatches, so the hand-sync from prior sessions was correct.
`get_advisors` (security) shows only pre-existing/by-design findings
(`authenticated`-callable `SECURITY DEFINER` RPCs, which is this app's
whole RPC access model) — nothing new introduced by this batch.

**Still open:** `supabase/tests/001_rls_and_hierarchy.sql` and
`003_notifications.sql` were updated for the cycle-boundary assertions in
a prior session but have still never been run (pgTAP needs a local/CI
Supabase instance this sandbox doesn't have) — run `supabase test db`
against this now-migrated project (or a branch of it) before trusting that
coverage. Live data present in this project (9 agents, 5,476 contacts, 61
call logs, etc.) was not touched — only DDL/function changes were applied.

## 2026-09-05 — types/database.ts hand-synced for P15 (new call sources); no pgTAP coverage yet

**What:** P15a/P15b add two new `call_source` enum values
(`existing_client`, `existing_recruit`), two new `daily_metrics` columns
(`src_existing_client`, `src_existing_recruit`), and update
`private.recompute_day`/`public.agent_aggregate`/`public.team_breakdown` to
compute and return them. `types/database.ts` was hand-edited to match
(same "no live Supabase instance in this sandbox" situation as
`7a4e694`'s P14a type sync) rather than regenerated via `npm run types`.

**Why deferred:** No local Supabase instance in this session
(`supabase start` needs a Docker daemon this sandbox doesn't have).

**Impact:** Low risk if the hand-edit is wrong (`7a4e694` confirmed the same
pattern only had a whitespace diff against the real regeneration last time),
but should still be verified: run `npm run types` against the applied
migration and diff against the hand-edit. Also no pgTAP coverage for the two
new enum values or columns — same gap as the P11/P12a entries above, same
fix shape (seed a call_log with the new source, assert `recompute_day`
counts it into the right column).

**Depends on / blocked by:** nothing technical — needs a working local (or
CI) Supabase instance to regenerate types and to write/run the pgTAP.

## 2026-09-03 — No pgTAP coverage for P12a's auto-nudge schema; golden-file import test not re-run

**What:** `20260903165109_p12a_auto_call_nudges.sql` added
`agents.auto_call_nudges_enabled`, the `agent_auto_nudge_log` table, and the
`set_auto_call_nudges`/`team_inactive` RPCs (the latter recreated with a new
return column) — none of it has pgTAP coverage, same gap as the P11 entry
below. Separately, `src/lib/import/commit-import.ts` was substantially
rewritten this pass (bulk contact resolution + chunked activity-table
inserts, replacing a fully sequential per-row loop) to fix large workbook
imports timing out, and the only integration test that exercises it against
a real database — `src/lib/import/__tests__/golden-file.test.tsx`
(`describe.skipIf(!canRun)`) — requires a local Supabase instance
(`supabase start`) this session didn't have running, so it was skipped, not
re-verified against the rewrite. New unit coverage was added instead
(`src/lib/import/commit-import.test.ts`, an in-memory fake Supabase client)
covering the specific behaviors the rewrite changed — cross-sheet contact
consolidation, idempotent re-import, name-first dedup — but that's not a
substitute for the golden-file test's real assertion: that the imported
`daily_metrics` numbers match the workbook's own Dashboard-tab formulas
exactly.

**Why deferred:** pgTAP tests are separate, non-trivial work (same reasoning
as the P11 entry). The golden-file test needs a running local Supabase
stack, unavailable in this session's sandbox.

**Impact:** a future migration could silently weaken the new
`auto_call_nudges_enabled`/`agent_auto_nudge_log` shape and nothing would
catch it. More importantly, run `npx vitest run src/lib/import/__tests__/golden-file.test.tsx`
against a local Supabase instance before the next deploy that touches
imports — the unit tests give confidence in the new logic in isolation, but
the golden-file test is what actually proves the rewritten commit path
produces the same real numbers as before.

**Depends on / blocked by:** nothing technical for the pgTAP half (same
shape as existing tests). The golden-file half just needs `supabase start`
run once, locally or in CI, with `NEXT_PUBLIC_SUPABASE_URL` /
`SUPABASE_SERVICE_ROLE_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` set.

## 2026-08-31 — Email deliverability (spam folder) needs DNS/dashboard config, not just code

**What:** Reported: outbound mail (magic-link, password reset, notifications)
sometimes lands in spam. Two code-level fixes landed alongside this note
(`src/app/auth/callback/route.ts` for the PKCE code-exchange bug that made
magic-link/reset-password emails look broken, and `List-Unsubscribe` /
`List-Unsubscribe-Post` headers on the three recurring notification emails
in `src/lib/notifications/{templates,send}.ts`), but the rest of inbox
placement is DNS/dashboard configuration this session has no access to:

1. **Verify the sending domain in Resend** (`resend.com` → Domains) rather
   than sending from a shared/default domain. `NOTIFICATIONS_FROM_EMAIL`
   must be `Team Tracker <notifications@your-verified-domain>`.
2. **Add the SPF, DKIM, and DMARC DNS records** Resend's domain page
   generates, at the registrar for that sending domain. Missing DKIM in
   particular is the single biggest cause of Gmail/Outlook spam
   classification.
3. **Point Supabase Auth's SMTP at the same verified domain** (Dashboard →
   Authentication → Emails → SMTP Settings — the commented-out block in
   `supabase/config.toml:236-246` documents the Resend SMTP host/port for
   local parity). Auth emails (magic link, password recovery) currently go
   out through whatever the hosted project's SMTP is configured to; if it's
   still Supabase's shared default sender, that's a separate deliverability
   gap from the notification emails above and explains "sometimes" rather
   than "always" landing in spam if only one of the two is misconfigured.
4. **Add a DMARC record** (`_dmarc.your-domain`) once SPF/DKIM pass
   consistently — start at `p=none` to monitor, tighten later.

**Why deferred:** all four steps require DNS registrar access and the
Resend/Supabase dashboards, which this session doesn't have. No further
code change unlocks this — it's an infra checklist for whoever holds those
accounts.

**Impact:** until done, inbox placement stays inconsistent regardless of
any further app code changes.

## 2026-08-31 — No pgTAP coverage for P11's admin/org-detachment schema changes

**What:** `p11c_admin_no_org.sql` added two check constraints
(`agents_org_required_unless_admin`, `agents_admin_no_upline`) plus a third
on `invitations`, and `p11b_agent_email_change.sql` added
`agent_email_changes` with no RLS policies at all (service-role only).
None of this has pgTAP coverage — `supabase/tests/*.sql` still only covers
the P1-era RLS/hierarchy shape, the `daily_metrics` pipeline, notifications,
and pilot instrumentation.

**Why deferred:** this pass was a documentation sync (`.github/Spec
Sheets/*.md` brought up to date with the P11 migrations and app changes
already shipped), not a testing pass — writing pgTAP tests is separate,
non-trivial work (seeding an admin row, asserting the constraints reject a
non-admin null-`org_id` insert and accept an admin one, asserting
`agent_email_changes` is unreachable from `authenticated`).

**Impact:** a future migration could silently weaken or drop either check
constraint and nothing would catch it before it reached production.

**Depends on / blocked by:** nothing technical — same shape as the existing
RLS/hierarchy tests in `supabase/tests/001_rls_and_hierarchy.sql`, just
scoped to the new constraints and table.

## 2026-08-27 — Playwright E2E suite was never built

**What:** `playwright.config.ts` is configured and CI has a `playwright` job
that runs `npm run e2e`, but there is no `e2e/` directory and no `.spec.ts`
file anywhere in the repo. None of the 10 scenarios in
`.github/Spec Sheets/05-testing.md` §4 exist — including the login→log→
roster flow, the offline-persistence test, and the follow-up-loop test that
exercises the product's core mechanic end-to-end.

**Why surfaced now:** found during a `/document-release` pass syncing the
Spec Sheets to the live codebase (2026-08-27) — `05-testing.md` described
this suite as built; it isn't. Not filed as a bug since nothing is broken,
but the CI `playwright` job currently passes trivially (zero tests to run)
rather than gating anything, which is worth knowing before trusting that
green check.

**Why deferred:** genuine scope, not a quick fix — building even the first
scenario (invite → signup → log → appears on `/team`, calling the metrics
drain RPC directly per the spec's own flakiness warning) means standing up
Playwright fixtures against a real Supabase instance. Not something to fold
into an unrelated change.

**Depends on / blocked by:** nothing technical — the spec (`05-testing.md`
§4) already has the scenario list written out. This is pure unstarted build
work, not a design decision waiting on input.

## 2026-08-27 — Activity Logs tab URL query param lags one click behind — RESOLVED, believed fixed by the Next 15 upgrade (2026-09-05)

**What:** On `/logs`, the `?type=` query param always reflected the
*previously* selected tab, not the one just clicked (e.g. clicking
"Sales" navigated to `?type=appointment`). The UI itself was always
correct — right tab highlighted, right table/empty-state shown — only
the URL was one step stale.

**Why deferred (originally):** Low severity (ISSUE-005 from `/qa`,
`.gstack/qa-reports/qa-report-localhost-2026-08-27.md`) — cosmetic
URL-state bug, not a functional break. Standard tier fixes
critical/high/medium; low severity is deferred by default.

**2026-09-05 investigation:** Asked to fix this. `src/app/(app)/logs/page.tsx`'s
`tabHref()`/`<Link>` tab-bar logic today is straightforward — no per-request
or per-render state that could produce a stale `type` value. Reproducing the
real app wasn't possible in this session's sandbox (no Docker daemon for
`supabase start`, and a full `npm install` fails on the `xlsx` CDN fetch
being blocked), so instead built an isolated Next.js 15.5.24 app in
`/tmp` reproducing the exact same tab-bar pattern (`searchParams` Promise,
`Object.entries` loop building the next `URLSearchParams`, `<Link>` per tab)
and drove it with Playwright (`chromium.launch`):
- Clicking through tabs and reading `page.url()` right after
  `waitForLoadState('networkidle')` *did* reproduce the exact "one click
  behind" symptom described.
- The same clicks, verified instead by polling for the tab's own rendered
  state (`waitForFunction`) or even just a fixed 50ms wait, always showed
  the correct URL — no lag, no flakiness, across repeated runs.

Conclusion: `networkidle` resolves before Next's client-side RSC transition
actually commits, so a `networkidle`-based Playwright check is one step
behind the real DOM/URL state — a testing-harness artifact, not a rendering
bug. That fits the timeline: the original `/qa` report and the Next 14.2.35
→ 15.5.24 upgrade (which also rewrote every `searchParams`-consuming page,
this one included, from a sync prop to the async `Promise` contract) landed
the same day (`7bad83a`); whatever produced the report likely predates that
rewrite and no longer applies to the async version of this page.

**Impact:** None currently identified — treating as resolved. If it
resurfaces, reproduce with a real browser interaction (not a `networkidle`-
gated automated check) before treating it as real, and note whether it's
specific to a build (dev vs. prod) or browser.

## 2026-08-26 — Regenerate ui-mockup.html for the light theme

**What:** Regenerate `.github/Spec Sheets/ui-mockup.html` to match the light
theme in `docs/03-ui.md` (white ground, navy accent, gold reserved for brand
mark/"filed" status, Plus Jakarta Sans, 10–28px radii, floating card shadows).

**Why:** It still renders the retired dark theme (`#08090A` ground, `#3D9AFF`
accent) — confirmed 8 references to the old palette still present. It's the
file CLAUDE.md calls "the rendered reference for all screens," so anyone who
opens it expecting the current UI gets an actively wrong picture.

**Pros:** Restores a trustworthy single-file visual reference for every screen
— useful for onboarding a new contributor or checking a screen's intended
layout without running the app.

**Cons:** Meaningful, standalone effort — regenerating a full static mockup
for every screen isn't a small edit. Best scoped as its own pass rather than
folded into unrelated work.

**Context:** `docs/03-ui.md` itself was rewritten in this review
(`/plan-design-review`, 2026-08-26) to match the live theme — the mockup
regeneration is the natural follow-up now that the token reference is
accurate. CLAUDE.md's doc-pointer table already flags the mockup as stale
inline so nobody trusts it by accident in the meantime.

**Depends on / blocked by:** `docs/03-ui.md` rewrite (done). Best done via
`/design-html`, which generates production-quality HTML from an approved
design direction — the direction here is already locked (the live app), so
this could also just be `/design-html` fed screenshots of the real app rather
than a fresh mockup exploration.
