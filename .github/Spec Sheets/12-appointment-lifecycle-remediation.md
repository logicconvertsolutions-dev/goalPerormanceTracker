# P25 — Appointment lifecycle remediation

**Status (2026-09-22): closed at Phase C.** Phases 0, A, B, C1 and C2 are
live in production. A post-Phase-C review found seven more appointment-flow
defects (N1–N7), fixed as P29 — see "After Phase C" in §5. **Phase D moved
out** to a separate notifications project; **Phase E is on hold.** Written
2026-09-20 after an end-to-end review of the appointment record/status/date
flow and its effect on `daily_metrics`.

**Why this exists:** P23 and P24 each redefined `appts_set` and shipped a
backfill against a read model with no behavioural test coverage for
appointments. Two of the resulting defects destroy data rather than
misreport it. This document is the remediation plan, sequenced so that
nothing user-visible breaks at any point and every step is independently
revertible.

Read with: `02-data-model.md` (schema/RPC contracts), `05-testing.md` (test
plan), `08-screen-specs.md` (per-page KPIs), `06-build-phases.md` (where P25
sits), and `13-p25-phase-c-staging-verification.md` (how to promote Phase C
and how to prove it on staging).

---

## 1. Verified findings

Every row below was confirmed by reading the current code on `dev`
(`8de88a0`). Severity: **S1** = data loss, **S2** = wrong numbers shown,
**S3** = missing/dead feature.

| # | Sev | Finding | Evidence |
|---|---|---|---|
| F1 | S1 | `recompute_day`'s trailing `delete` guard names only `calls_made, appts_set, sales_count, recruiting_convos, follow_ups_due`. A day whose only activity is a *resolved* appointment (held/no_show/cancelled/rescheduled) is inserted and then immediately deleted. Referrals captured on a held appointment go with it. | `20260920110000_p24…sql:200-203` |
| F2 | S1 | `purge_old_call_logs` deletes aged call logs → fires `call_logs_metrics` (AFTER DELETE) → marks the old day dirty → `recompute_day` recomputes `calls_made`/`appts_set` to 0 from now-deleted rows → F1's guard removes the `daily_metrics` row. The read model exists to outlive raw-row purging and does not. `organizations.call_log_retention_months` **defaults to 24, NOT NULL** — armed for every org. P23 widened the blast radius by repointing `appts_set` at `call_logs`. | baseline `:351-366`, `:2405`, `:1963` |
| F3 | S2 | `appts_set`'s appointments half counts rows *currently* `status='scheduled'`, bucketed by `created_at`. Resolving an appointment therefore erases the "set" event that created it. Mark one Held and the cycle reads **Appts Set 0, Appts Held 1**. | `20260920110000…:125`, `:164-170` |
| F4 | S2 | `appts_set = call_logs.outcome='appointment_set' + appointments.status='scheduled'`, with no link or dedup between them. An agent who logs the call *and* creates the appointment row counts the same appointment twice. | `20260920110000…:125` |
| F5 | S2 | Import never sets `created_at`, so it defaults to `now()`. Every imported row with `status='scheduled'` counts toward `appts_set` **on the import day**, regardless of `appt_date`. The P24 backfill bakes the same rule into history. | `commit-import.ts:161-168` |
| F6 | S1 | Imported rows have no `appointment_at`. Opening an imported **Scheduled** appointment in the edit form defaults the date/time inputs to *today*; saving derives `appt_date` from them. Editing a note silently moves the appointment to today. | `appointment-form.tsx:109-111`, `:215-217` |
| F7 | S2 | `pipelineValueOpenAppts` sums `expected_premium_cents` where `status='scheduled'`, but the form only submits that field in the non-scheduled branch and hides the input when scheduled. **No app-created scheduled appointment can carry a premium** → Open Pipeline is permanently $0 on the agent dashboard and the SMD per-agent page (non-zero only for imported rows). | `metrics.ts:150`, `appointment-form.tsx:215-219`, `:387` |
| F8 | S2 | Resolving a future-dated appointment rewrites `appt_date` to today (`actions.ts:247`) and the full form nulls `appointment_at` for any non-scheduled status (`actions.ts:198`). The quick dropdown does *not* null it. Two routes to the same action leave two different rows, and `appt_date`/`appointment_at` can silently disagree. The real date/time of a held appointment is unrecoverable. | `actions.ts:198`, `:236-250` |
| F9 | S2 | Reschedule is undefined. Marking the old row `rescheduled` + creating a successor generates a **second** `appts_set` event for one appointment and counts it twice in the no-show denominator. Editing the same row's date instead keeps `appts_set` correct but never sets `appt_rescheduled`, so churn is invisible. The app picks neither. | `actions.ts:180-230` |
| F10 | S2 | Two different no-show rates. `/appointments` divides by all rows in the period including future-dated ones; the dashboard RPCs clamp to `least(p_to, current_date)`. Mid-cycle the screens disagree. | `appointments/page.tsx:59`, `20260920110000…:249` |
| F11 | S3 | An appointment booked from a call (`call_logs.appointment_at`) has **no status**. My Day offers only Snooze / Mark done; `appointment_done_at` feeds nothing. It can never become Held, No-show, Cancelled or Rescheduled. | `today-row.tsx:69-71`, `today/actions.ts:69-81` |
| F12 | S3 | `appointments.follow_up_on` is written by the form for held/no_show/rescheduled/cancelled but `my_followups` reads **only `call_logs`** in both branches, and `follow_ups_due/done` likewise. The follow-up never surfaces. An index for it exists and is unused. | `20260920100000…:203-240`, baseline `:2253` |
| F13 | S3 | No appointment reminders exist. Notification kinds are `evening_nudge`, `sunday_summary`, `monday_digest` only. Combined with My Day surfacing an appointment only once `appointment_at::date <= today`, and `/appointments` hiding anything outside the current period, **an appointment booked for next week is invisible until the day**. | baseline `:179-186` |
| F14 | S2 | Offline-queued appointments get `created_at` at sync time, so `appts_set` lands on the sync day. | `offline-sync.tsx:14` |
| F15 | S2 | `syncLinkedRecords` sets the linked sale's `saleDate` from the render-time `const apptDate`, not the value in the date input the user may have just changed. | `appointment-form.tsx:143`, `:158` |
| F16 | S3 | `sales_appointment_id_fkey` is `ON DELETE SET NULL`. Deleting an appointment leaves its sale counting in `sales_count`/`premium_cents`, unreachable from the UI that created it. | baseline `:2632` |
| F17 | S3 | `002_daily_metrics_pipeline.sql` tests the dirty→drain→recompute pipeline correctly, but all 9 assertions go through `call_logs`/`calls_made`. Nothing asserts on `appts_set` or any `appt_*` column, which is why F1/F3/F4 shipped green. | `supabase/tests/002…sql` |

**Checked and NOT a defect** (recorded so it isn't re-litigated):
- P24's `least(p_to, current_date)` clamp scope is correct — only
  `agent_aggregate` and `team_breakdown` expose `appt_scheduled`, and those
  are the two it redefined.
- `appt_type` is required at create for every status, so the "type required
  when held" guard in `updateAppointmentStatusAction` is reachable only for
  imported/legacy rows.
- `appointments_own` RLS checks `agent_id = auth.uid()` only, with no
  `org_id` predicate. Strictly narrower than org scope, so not exploitable;
  noted against CLAUDE.md rule 8's "two fences" as a hardening item, not a
  hole.

**Known edge case, low priority:** `team_period_summary`'s streak counts
`daily_metrics` rows with `calls_made >= min_calls_per_day`. If an org sets
`min_calls_per_day = 0`, a future-dated row created by a scheduled
appointment would count toward a streak. Guard in Phase B.

---

## 2. Root cause

One sentence: **the appointment has no identity of its own.** It is
reconstructed from whichever table happens to hold it, bucketed by a date
column that gets rewritten on resolution, and counted by a filter on its
*current* status rather than by an event that happened once.

Three specific mistakes follow from that:

1. **A mutable column is used as an event date.** `appt_date` means
   "scheduled for" while pending and "resolved on" afterwards. No single
   question can be asked of it.
2. **An event count is derived from a state filter.** `appts_set` counts
   rows *in* `scheduled`, not rows that *entered* `scheduled`. State filters
   are not event counts; they erode.
3. **A read model is guarded by a subset of its own columns.** F1/F2 are
   both the delete guard not knowing about the columns the table gained.

The fixes below address the causes, not just the symptoms.

---

## 3. Target model

Additive. No column is dropped in this plan.

```
appointments
  id, agent_id, org_id, contact_id                    (unchanged)
  appt_type, status, notes                            (unchanged)
  expected_premium_cents, referrals_given             (unchanged)
  client_request_id, import_row_hash                  (unchanged)

  set_on            date        NOT NULL   -- NEW: booking day, agent-local, IMMUTABLE
  scheduled_for     timestamptz NULL       -- NEW: the actual slot, IMMUTABLE across status changes
  resolved_on       date        NULL       -- NEW: day the outcome was recorded
  source_call_log_id uuid       NULL       -- NEW: the call that set it (FK, ON DELETE SET NULL)
  rescheduled_to_id  uuid       NULL       -- NEW: successor appointment (FK, ON DELETE SET NULL)

  appt_date         date        NOT NULL   -- KEPT, maintained by trigger for back-compat
  appointment_at    timestamptz NULL       -- KEPT, dual-written during migration, retired in Phase E
```

`appt_date` is maintained by a `BEFORE INSERT OR UPDATE` trigger as
`coalesce(resolved_on, scheduled_for::date at agent tz, set_on)` so every
existing query, index and page keeps working untouched through Phases A–D.

### Metric definitions (the contract)

```
appts_set(day)   = appointments where set_on = day                      -- ALL statuses
                 + call_logs where outcome='appointment_set'
                     and call_date = day
                     and not exists (appointment with source_call_log_id = this call)
```

The second term matches only legacy rows — once the call form creates
appointments (Phase C), new calls always have a linked row. The definition is
therefore stable across the cutover and needs no second backfill.

```
appt_scheduled(day) = appointments where status='scheduled' and appt_date = day
appt_held(day)      = appointments where status='held'      and resolved_on = day
   (same shape for no_show / cancelled / rescheduled)

no_show_rate(period) = appt_no_show
                     / (appt_held + appt_no_show + appt_cancelled)
```

`appt_scheduled` and `appt_rescheduled` leave the denominator: a pending
appointment has no outcome yet, and a rescheduled one is continued by its
successor — counting both double-counts the prospect. This changes the
published rate; it is intentional and called out in §9.

### Status machine

```
                  ┌───────────────────────────────┐
   (booked) ──▶ scheduled ──┬──▶ held          (terminal)
                            ├──▶ no_show       (terminal)
                            ├──▶ cancelled     (terminal)
                            └──▶ rescheduled ──▶ creates successor (scheduled)
```

- Only `scheduled` is non-terminal.
- A terminal row is never reopened; correcting a mistake is an explicit
  "undo" that clears `resolved_on` and returns it to `scheduled` (audited).
- `rescheduled` requires a successor; the pair is linked by
  `rescheduled_to_id`. A chain has a depth cap (§7, E11).

---

## 4. Decisions taken (flag now if you disagree)

These are product calls. Each is implemented as stated unless you say
otherwise — raising them after Phase C is expensive.

| # | Decision | Rationale | Cost if reversed later |
|---|---|---|---|
| D1 | **Reschedule creates a successor row**, old row terminal, linked by `rescheduled_to_id`. Editing a `scheduled` row's date is *not* a reschedule (that's fixing a typo). | Preserves churn signal and keeps one appointment = one `set_on` event, since only the original row's `set_on` counts (§3 counts successors too — see D2). | Medium — needs a lineage backfill. |
| D2 | **A successor counts as a new `appts_set`.** | A reschedule is real re-booking work. The alternative (suppress successors) hides activity the SMD is measuring. | Low — one line in the metric. |
| D3 | **`rescheduled` and `scheduled` leave the no-show denominator.** | A pending or continued appointment has no outcome. | Low — one line, but it re-publishes the rate. |
| D4 | **Legacy call-log appointments are NOT backfilled into `appointments`.** They stay countable via the `not exists` clause and never enter the held/no-show funnel. | Their outcome was never recorded. Fabricating `held` would inflate target attainment; fabricating `scheduled` would poison the denominator forever. Truthful absence beats invented data. | Low — can be backfilled later if desired. |
| D5 | **Appointment type stays required at create**, and the call form gets it as an optional select defaulting to `follow_up`. | The call form is the hot path (~40 uses/day); a required field there costs more than it's worth, and the held-guard already forces the answer when it matters. | Low. |
| D6 | **Call notes and appointment notes stay separate.** Not copied at creation. | They are different facts; copying creates silent divergence on edit. | Low. |
| D7 | **A call-created appointment is bound to the called contact.** No contact picker on the call form. | Keeps the hot path fast; `/appointments/new` still handles the referral-books-a-friend case. | Low. |
| D8 | **Historical `appts_set` changes again** under the new definition. | It is currently wrong in both directions (F3 erosion, F4 double-count). One more corrected restatement is better than permanent wrongness. | N/A — but it must be communicated (§9). |
| D9 | **Reminders are in-app + Web Push. No email.** | Requested 2026-09-20. Push is built as a reusable channel; appointment reminders are its first consumer. No Resend template, no email unsubscribe surface. | Low — email can be added later as a third channel behind the same interface. |
| D10 | **`web-push` approved as a new prod dependency** (rule 11). Server-only. | Hand-rolled VAPID/ECDH/aes128gcm fails silently on device when subtly wrong. Update CLAUDE.md's locked-stack line when it lands. | Low. |
| D11 | **`notification_log` is not touched.** New kinds use `notification_deliveries` + `notification_channel_prefs`. | Its `UNIQUE (agent_id, kind, local_date)` and `kind` CHECK are correct for daily digests and wrong for per-entity events. Widening them would put the three live email kinds at risk for no benefit. | Low — legacy booleans can migrate onto the new tables later. |

---

## 5. Phased plan

Five phases. **Each is independently shippable, independently revertible,
and leaves the app fully working.** Phases A and B change no UI at all.

Per CLAUDE.md: migration files are written and reviewed; `supabase db push`
is never run from a Claude session. Promotion is `dev` → `staging` →
`master` (PR), with `staging` verified against the actual database, not the
status field.

### Phase 0 — Characterization tests (no production change)

Pin today's behaviour *before* touching it, so every later diff proves
itself.

- New `supabase/tests/007_appointment_lifecycle.sql` asserting **current**
  behaviour, including the bugs: a day with only a cancelled appointment
  produces no `daily_metrics` row (F1); resolving erodes `appts_set` (F3);
  both sources double-count (F4).
- Snapshot script `scripts/metrics-snapshot.sql` → per-agent, per-month sums
  of every `daily_metrics` column. Run against staging and production before
  and after each backfill; the diff is the review artifact.

**DoD:** suite green *because it encodes the bugs*. Phase A flips these
assertions in the same commit that fixes them — that inversion is the proof.

**Revert:** delete the files. Nothing else touched.

---

### Phase A — Stop the bleeding (DB only, no app change) ✅ IMPLEMENTED

Shipped as `20260920120000_p25a_metrics_integrity.sql`. Fixes **F1, F2, F3,
F5**. Two deviations from this section as originally written, both decided
during implementation and recorded in the migration header:

- **F4 is deferred to Phase B.** Deduping the two sources needs
  `appointments.source_call_log_id`. The only Phase-A alternative was matching
  heuristically on `(contact, appointment_at)` — rejected because
  `updateAppointmentAction` nulls `appointment_at` on resolution (F8), so the
  match would break on resolve and `appts_set` would flap between 2 and 1 as
  an appointment moved through its lifecycle. A stable wrong number beats an
  unstable one. Pinned by an explicit test so it cannot be forgotten.
- **F5 is fixed in the metric, not by rewriting `created_at`.** Imported rows
  are bucketed by `appt_date`. Mutating `created_at` would destroy the record
  of when the import ran and make the migration irreversible; as written,
  Phase A stays a pure function swap with **no app change at all**, and Phase
  B's `set_on` backfill reuses the same rule.

Also revised: the rebuild is driven by marking agent-days dirty rather than a
hand-written `UPDATE`. See REBUILD STRATEGY in the migration header — a
hand-written backfill is a second definition of the metric that can drift from
`recompute_day`, which is exactly how P23 and P24 went wrong.

Original scope as planned, for reference:

**Migration `2026MMDD000000_p25a_metrics_integrity.sql`:**

1. `recompute_day`: extend the delete guard to every counted column —
   `appt_scheduled, appt_held, appt_no_show, appt_rescheduled,
   appt_cancelled, referrals_given, follow_ups_done`. Safer still: guard on
   "every counter is zero" by construction rather than a hand-listed subset,
   so the next added column can't reintroduce F1.
2. `recompute_day`: `appts_set` per §3 — appointments by `set_on`
   regardless of status, plus unlinked legacy call logs. (Phase A uses
   `(created_at at time zone tz)::date` as `set_on` until Phase B adds the
   real column; the expression is identical for rows created after P24.)
3. `purge_old_call_logs`: **do not let purging rewrite history.** Preferred
   fix — the purge sets a `private.purging` flag (a `set_config` local GUC)
   that `enqueue_metrics` checks and skips, so purged days are never
   re-marked dirty and `daily_metrics` keeps its frozen aggregate. Fallback
   if that proves fragile: exclude dates older than the retention window
   from `recompute_day`'s delete clause.
4. Backfill `appts_set` under the new definition, batched (§6).
5. Restore any `daily_metrics` rows already destroyed by F1/F2 where the
   source rows still exist, by re-marking those agent-days dirty. **Days
   whose call logs were already purged are unrecoverable** — quantify the
   loss in the Phase A PR (§6 step 2).

**App changes:** `commit-import.ts` sets `created_at` from `appt_date` for
imported rows (fixes F5 going forward); a one-off backfill corrects existing
imported rows.

**Verification:** snapshot diff shows `appts_set` changing only in the
expected direction; no `daily_metrics` row count decreases; `002` and `007`
green.

**Revert:** re-apply the previous function bodies (kept verbatim in the
migration header) and re-run the backfill with the old definition. Column
state is untouched, so revert is a pure function swap.

---

### Phase B — Additive schema ✅ IMPLEMENTED

Shipped as `20260920130000_p25b_appointment_identity.sql`. Fixes **F8** and
**E3**, guards **E20/E11**, and makes Phase C possible. One deviation from
this section as written, decided during implementation:

- **No dual-write in the app.** This section called for the server actions
  to write both the old and new columns. A `BEFORE INSERT OR UPDATE` trigger
  does it instead, because the invariant then holds for *every* writer —
  the live app, the offline replay queue submitting a pre-Phase-B payload
  days later (E15), the import path, psql — rather than only the code paths
  we remembered to update. The consequence is that **Phase B shipped with no
  application change at all**, so it could be judged on the data alone.

Also narrower than planned in one place, deliberately: the
`appt_scheduled/held/no_show/rescheduled/cancelled` counts stay bucketed by
`appt_date` rather than moving to `resolved_on`. The trigger maintains
`appt_date = resolved_on` for every terminal row, so they are equal by
construction — keeping `appt_date` moved one metric instead of six and left
Phase A's verification queries valid.

**F4 remains deferred.** The dedup clause ships here but is inert until
Phase C populates `source_call_log_id`; legacy rows are not retro-linked
(see the migration header for why, and its footer for a read-only query
measuring how many rows a retro-link would affect).

Staging verification: `set_on` immutable, `scheduled_for` survives
resolution through the old code path, all columns correctly populated, zero
linked rows, and the Phase A metric query returned identical values — the
migration moved no numbers.

Original scope as planned, for reference:

**Migration `…_p25b_appointment_identity.sql`:**

1. Add `set_on`, `scheduled_for`, `resolved_on`, `source_call_log_id`,
   `rescheduled_to_id`. All nullable at first.
2. Backfill (§6): `set_on` from `created_at at time zone tz`, except
   `import_row_hash is not null` → `appt_date`; `scheduled_for` from
   `appointment_at`; `resolved_on` from `appt_date` where status is terminal.
3. `set_on` → `NOT NULL` **after** the backfill verifies at 100% coverage.
4. `BEFORE INSERT OR UPDATE` trigger maintaining `appt_date` from the new
   columns, so every existing reader keeps working.
5. Column-level protection for `set_on` and `scheduled_for` per CLAUDE.md
   rule 1 — a trigger rejecting updates to `set_on`, and to `scheduled_for`
   once the row is terminal. Grants + trigger, not a policy.
6. Indexes: `(agent_id, set_on)`, `(agent_id, scheduled_for) where status =
   'scheduled'`, `(source_call_log_id)`. Note `CREATE INDEX CONCURRENTLY`
   cannot run inside the migration transaction — either accept the brief
   lock (small table) or run them as a separate non-transactional step.
7. `recompute_day` reads the new columns.
8. Fix the `min_calls_per_day = 0` streak edge case.

**App changes:** server actions dual-write old and new columns. Readers
unchanged. `updateAppointmentStatusAction` and `updateAppointmentAction`
stop rewriting `appt_date` and stop nulling `appointment_at` — they set
`resolved_on` instead (fixes F8).

**Revert:** drop the trigger and the new columns. `appt_date`/
`appointment_at` were still being written throughout, so old code is
immediately correct again.

---

### Phase C1 — Single record (the invisible half) ✅ IMPLEMENTED

Shipped as `20260920140000_p25c1_call_creates_appointment.sql` plus the app
changes below. Fixes **F4** (for good), **F11** and **F12**. Items 1 and 2
of the Phase C list; items 3-9 are C2.

No new screen. The only visible change is an optional **Appointment type**
select on the call form, shown when the outcome is "Appointment set" (D5).

**What landed:**

- `logCallAction` creates an `appointments` row for outcome
  `appointment_set`, with `source_call_log_id`, `set_on = call_date`,
  `scheduled_for = appointmentAt`, `status='scheduled'`, and the type from
  the new select (default `follow_up`). `call_logs.appointment_at` is still
  written for back-compat and retires in Phase E. Notes are not copied (D6);
  the contact is the one that was called (D7).
- **F4 closes with no migration work and no restatement.** Phase B shipped
  the dedup clause inert; C1 simply starts populating the column it reads.
  Nothing is backfilled (D4), so no historical number moves — unlike Phase
  A's seven restated agent-days (§9a), there is nothing to announce here.
- `my_followups` gains two branches over `appointments` and dedups the
  legacy `call_logs` one. Four kinds across two tables; the contract table
  is in `02-data-model.md`. Without the dedup, every appointment booked
  after this deploys would have appeared on My Day twice.
- `appointments_source_call_log_idx` became **UNIQUE** — "one call produces
  at most one appointment" is now a table invariant rather than a
  server-action convention (E16).
- New pgTAP suite `009_appointment_call_link.sql` (13 assertions) and
  `src/app/(app)/log/actions.test.ts` (9 tests).

**Deviations and decisions taken during implementation:**

- **My Day's row menu changed, slightly.** "No UI change beyond the Type
  select" could not survive contact with the status machine: once the queue
  is sourced from `appointments`, "Mark done" has no honest target. There
  is no `done` status, and `appointment_done_at` — what it used to write —
  fed nothing at all (F11). Mapping it to `held` would have made every
  dismissal an Appts Held the SMD reads. So for a pending appointment the
  single "Mark done" item is replaced by **Held / No-show / Cancelled**, in
  the same dropdown. Snooze stays and moves `scheduled_for` by whole
  *agent-local* days (E4, via the new `shiftZonedTimestampByDays`).
  **Rescheduled is deliberately absent** — per D1 it needs a successor row
  and the new slot, which is C2's picker.
- **Resolving now stamps `resolved_on` with today, always.** Previously
  `updateAppointmentStatusAction` rewrote `appt_date` to today *only* when
  the appointment was future-dated, so an appointment held last Tuesday and
  recorded this morning landed its Appts Held on last Tuesday — reaching
  into a cycle that may already be closed. E6 says `resolved_on` is the
  recording day; it now is. This moves numbers **going forward only** (no
  backfill), and only for outcomes recorded late.
- **One definition of "resolve", not two.** My Day's resolve delegates to
  `updateAppointmentStatusAction` rather than writing the row itself. Two
  code paths for one action, leaving two different rows, is the exact shape
  of F8 — adding a second one while fixing the first would be absurd.
- **Editing a call carries the edit across** to the appointment it created:
  move the slot, create the row if the outcome just became
  `appointment_set`, drop a still-pending row if it stopped being one. Not
  in the section as written, but without it the call form could move an
  appointment on one screen and not the other. A **resolved** appointment
  is never touched — its slot is a recorded fact (F8) and its outcome is a
  number the SMD has already seen. `set_on` is never written on update; the
  Phase B trigger would reject it anyway.
- **Deleting a call leaves its appointment standing.** The FK is
  `ON DELETE SET NULL`, so the row survives, keeps its `set_on`, and keeps
  counting. Deleting a real appointment because the call record was tidied
  up would be data loss; the metric stays correct either way, which is the
  point of the §3 definition.
- **F14 is half fixed.** The call form's half is done — `set_on` comes from
  the submitted `callDate`, so an offline replay buckets on the day the
  agent booked, not the day it synced. `/appointments/new` still stamps the
  sync day, because the fix there is a form change and that form is C2's
  subject.
- **`02-data-model.md` had never been updated for Phase B** (its own DoD
  item in §10). Done here, since C1's RPC contract is unreadable without
  it: the five columns, the indexes, the identity/link triggers, the status
  machine and the §3 metric contract.

**What agents see on deploy** (production, 2026-09-20, before promotion):
no number moves, but My Day gains **nine rows** — 4 scheduled appointments
(6–30 days late) that previously had no way to be resolved at all (F11),
and 5 appointment follow-ups (0–20 days late) that the form wrote and
nothing read (F12). Zero rows were already linked, so the unique index is
safe; zero outstanding legacy call-log appointments, so the
`call_appointment` branch matches nothing live. The Overdue tile ticks up
for the agents who own those nine. The migration footer carries the query —
re-run it before promoting.

**Not verified locally:** pgTAP could not run in the authoring environment
(the Docker registry is blocked by network policy, so `supabase start`
cannot pull its images). `007`/`008`/`009` run in CI as `npm run test:rls`;
treat CI as the gate. Typecheck, ESLint, `next build` and the 104-test
vitest suite were all run and are green.

**Revert:** app-only plus a function swap and an index shape — see the
migration footer. Appointment rows created by the call form survive a
revert and keep counting through `set_on`; `appts_set` simply returns to
double-counting linked pairs.

---

### Phase C2 — Lifecycle UI ✅ IMPLEMENTED

Shipped as `20260920150000_p25c2_reschedule_and_overdue.sql` plus the app
changes below. Fixes **F6, F7, F9, F10, F15, F16** and F14's remaining
half. With C1, Phase C is complete.

**What landed:**

- **Resolve sheet** (`resolve-appointment-dialog.tsx`), shared by My Day
  and `/appointments`. Held opens it (Type, Expected premium, Referrals
  given, Notes, "Log as a Sale" for an Application); No-show and Cancelled
  stay one tap, because there is nothing to ask; **Reschedule** opens a
  date/time picker.
- **F9 / D1 — reschedule is defined.** `rescheduleAppointmentAction`
  terminates the original as `rescheduled` and creates a successor linked
  by `rescheduled_to_id`. The successor carries its own `set_on` (D2 — a
  rebooking is real work) and the predecessor's premium (so Open Pipeline
  does not drop because a prospect moved). Idempotent: a second call finds
  the link and returns it rather than creating a second successor. If the
  link-up fails the successor is rolled back, because an orphan would
  count an Appts Set for a rebooking that never completed.
- **E11 — the chain is a list.** A unique index gives each successor one
  predecessor; a trigger rejects cycles (A→B→A, which Phase B's
  self-reference check could not see) and caps depth at ten.
- **F7 — Open Pipeline works.** Expected premium is shown and submitted for
  a *scheduled* appointment. It was previously in the non-scheduled branch
  only, so no appointment the app could create was able to carry one and
  the tile was structurally $0 everywhere except for imported rows.
- **F10 — one no-show rate.** `noShowRateFrom` in `lib/metrics.ts` is now
  the only implementation; `/appointments`, the agent dashboard and the SMD
  drill-down all call it. Per §3/D3 the denominator is outcomes only —
  `held + no_show + cancelled`. The tile shows its denominator.
- **F6 — the edit form stops moving appointments to today.** It reads
  `scheduled_for` (which Phase B guarantees survives resolution) and falls
  back to the row's own `appt_date`, never to today.
- **F15 — a linked sale inherits the date actually submitted**, not the one
  the page happened to load with. The Date input is controlled now.
- **F16 — deleting an appointment with a linked sale asks first**, naming
  the premium at stake, with *Keep it* and *Delete both* as separate
  answers. Both are legitimate; not being asked is not.
- **F14 — the appointment form submits its own booking day**, clamped
  server-side to today. An offline replay now books on the day the agent
  did it.
- **Upcoming section** on `/appointments`, outside the period filter, in
  two bands: **Needs an outcome** (past its slot, still pending — the band
  that stops stale appointments quietly shrinking every outcome-based
  denominator) and **Upcoming**.
- New pgTAP suite `010_appointment_reschedule.sql` (15 assertions) and
  `appointments/actions.test.ts` (12 tests).

**Deviations and decisions taken during implementation:**

- **The "sheet" is a Dialog.** There is no sheet primitive in the app and
  rule 11 says no new dependency without asking, so it is built on the
  existing Radix Dialog — the same treatment the appointment form's delete
  confirmation already uses. On a phone it is a centred modal rather than a
  bottom sheet. Worth revisiting if a sheet primitive ever lands.
- **The resolve sheet loads its own defaults** via
  `appointmentResolveDefaultsAction` rather than `my_followups` growing
  columns for them. The queue RPC runs for every row on every My Day load;
  these fields are read only after an agent has chosen to resolve one.
- **The full form's Date field now writes `resolved_on`.** It was silently
  inert on an already-resolved row: the Phase B trigger keeps
  `old.resolved_on` when none is supplied and re-derives `appt_date`
  straight back from it, so editing the date did nothing. E8 still holds —
  the form submits the row's existing date unless the agent changes it.
- **Re-recording a held appointment's details does not move its resolution
  day.** Only a `scheduled → terminal` transition stamps `resolved_on`; a
  correction to an outcome already recorded keeps the day it was recorded
  on. Same rule in `resolveAppointmentHeldAction` and
  `updateAppointmentStatusAction`.
- **A failed sale does not fail the outcome.** If "Log as a Sale" cannot
  save, the appointment is still Held and the action says so
  (`saleWarning`) rather than returning a flat failure that would leave the
  sheet open over a recorded outcome and invite recording it twice.
- **`KpiCard` gained a `hint` prop** so the no-show tile can show its
  denominator. A rate whose denominator just changed, with no way to see
  it, is a rate nobody trusts — which is half of what F10 cost.
- **Reschedule is not offered for an already-resolved appointment.** D1
  makes it a transition out of `scheduled`; reopening a terminal row is a
  separate, audited "undo" that this phase does not build.

**The no-show rate is the restatement to communicate** (§9, D3). It changes
for historical periods on every screen. Nothing else in C2 moves a stored
number.

**Measured against production, 2026-09-20 — the restatement is invisible.**
`scripts/noshow-restatement-preview.sql` computes both formulas side by
side and returns **zero rows**: across all 31 agent-cycles in the product's
history, not one contains a single no-show. Every displayed rate is 0%
under both the old formula and the new one, for every agent, for every
cycle ever recorded.

So **no agent's number changes on this deploy**. §9's comms requirement is
satisfied by documenting the definition (done, in `02-data-model.md` and
`08-screen-specs.md`); there is nothing for an agent to be told they will
see move, because nothing moves. That will stop being true the first time
anyone records a no-show, which is precisely the argument for shipping the
correct formula now rather than after it has a visible number attached to
it.

Also measured: zero rows carry `rescheduled_to_id` and zero are
`rescheduled`, so both new guards create safely. One scheduled appointment
(imported) already carries a premium, and one sale is linked to an
appointment — so F16's dialog has exactly one live case to exercise on
staging, and Open Pipeline has one non-zero row to prove itself against.

**Not verified locally:** pgTAP could not run in the authoring environment
(the Docker registry is blocked by network policy). `007`–`010` run in CI
as `npm run test:rls`. Typecheck, ESLint, `next build` and the 120-test
vitest suite are green.

**Revert:** app-only plus a function swap, two guards and an index — see
the migration footer. Reschedule pairs already created keep their links and
keep counting.

---

### After Phase C — appointment flow fixes (P29) ✅ IMPLEMENTED

Shipped as `20260922120000_p29_appointment_slot_frozen.sql` plus app
changes. Found in a review on 2026-09-22 of the code as it stood after
Phase C and everything merged since (P26–P28 did not touch appointments).

| # | Sev | Finding | Fix |
|---|---|---|---|
| N1 | S1 | Editing a **pending** appointment's date/time on the edit form was silently discarded. `updateAppointmentAction` wrote `appointment_at`; on an UPDATE the Phase B identity trigger copies that into `scheduled_for` only when `scheduled_for` is null, so the old slot survived and `appt_date` was re-derived from it. | The action writes `scheduled_for` for a scheduled status. |
| N2 | S2 | The full form (create and edit) and the quick status change offered **Rescheduled** directly — no new time, no successor. The appointment ended terminal, dropped out of every queue, and nothing continued it. Contradicts D1. | Only `rescheduleAppointmentAction` may move a row into `rescheduled`; a rescheduled row **with a successor** cannot be reopened. The UIs stop offering it. |
| N3 | S2 | Two reschedules at once (two devices/tabs) both passed the read-then-write idempotency check; the second link-up overwrote the first, orphaning a successor that counted an extra Appts Set (E17). | The link-up is conditional on `status='scheduled' and rescheduled_to_id is null`; the loser deletes its own successor and returns the winner's. |
| N4 | S3 | `updateAppointmentStatusAction` had no Zod validation (rule 7) and returned `ok: true` for a row that didn't exist. | Validated; not-found and DB errors are reported. |
| N5 | S2 | `xlsx` came from `xlsx-latest`: the next SheetJS release changes that file and every `npm ci` fails the lockfile integrity check. | Pinned to the 0.20.3 tarball (same version, same hash). |
| N6 | S3 | "`scheduled_for` immutable once terminal" (E19) was documented but only the NULL case was enforced; a direct write could move a resolved appointment's slot. | `private.appointments_slot_frozen` trigger. |
| N7 | S3 | Changing the appointment type on the call edit form never reached the appointment (the sync only filled a missing type). | The submitted type wins; a payload with no type keeps the row's (E15). |

**Deliberately app-level, not a DB constraint (N2):** a `rescheduled` row with
no successor stays legal in the database — imports and pre-C2 rows carry it,
a deleted successor produces it (E10), and `007`'s fuzz writes it. The DB
guard added is N6 only.

**Tests:** `011_appointment_slot_frozen.sql` (10 assertions); 21 new vitest
cases across `appointments/actions.test.ts` and `log/actions.test.ts`; the
first 20 were run against the pre-fix code and 14 failed there, i.e. they
detect the defects rather than merely describe the new code. The N6 trigger was
also exercised against a local Postgres 16 with the real Phase B trigger
body; pgTAP itself could not run in the authoring sandbox (container images
blocked), so CI is the gate.

**Revert:** app-only plus dropping one trigger — see REVERT in the migration header.

---

### Phase C — Single record + lifecycle UI (original scope, for reference)

Fixes F6, F7, F9, F11, F12, F15, F16, and F10.

1. **Call form creates the appointment.** Outcome `appointment_set` → the
   server action creates an `appointments` row with
   `source_call_log_id`, `set_on = call_date`, `scheduled_for =
   appointment_at`, `status='scheduled'`, plus the new optional Type select
   (D5). `call_logs.appointment_at` keeps being written for back-compat and
   is retired in Phase E.
2. **My Day reads appointments.** `my_followups` gains a third branch over
   `appointments` where `status='scheduled'`; `appointments.follow_up_on`
   joins the queue (fixes F12). Snooze/Mark-done are replaced by
   **Held / No-show / Rescheduled / Cancelled**.
3. **Resolve sheet.** Held opens a compact sheet (Type if unset, Expected
   premium, Referrals given, Notes, "Log as a Sale"); the other three are
   one tap. Reschedule opens a date/time picker and creates the successor
   (D1).
4. **Open Pipeline fixed (F7):** show Expected premium on the *scheduled*
   form and submit it in both branches.
5. **Upcoming section** on `/appointments`, outside the period filter,
   showing `scheduled_for` with the time. Overdue-unresolved gets its own
   band.
6. `/appointments` no-show rate uses the §3 formula (fixes F10).
7. Guard deleting an appointment with a linked sale (F16): warn and require
   an explicit choice.
8. `syncLinkedRecords` reads the submitted date, not the render-time const
   (F15).
9. Edit form uses `scheduled_for` and never defaults a persisted appointment
   to today (F6).

**Revert:** app-only; revert the deploy. Phase B columns stay populated and
harmless.

---

### Phase D — In-app bands + Web Push (F13) — MOVED OUT OF P25

**Decision 2026-09-22:** notifications are their own project — push
notifications, a calendar view, a notifications icon, and reminders for
appointments, due calls and tasks, for every user, alongside the existing
email alerts. This phase is not built here.

**Consequence of stopping at C:** no number changes and no data is at risk
— every integrity fix lives in A–C2. What stays missing until that project
lands: My Day shows an appointment only on its own day (`/appointments`'
Upcoming section is the forward view), and nothing reminds anyone.

**The D-1 branch** (`claude/p25-phase-d-appointment-pe3n94`, one commit,
unmerged): widens `my_followups`' appointment branches to `p_as_of + 7`,
bands My Day (Starting soon / Needs an outcome / Overdue follow-ups / Later
today / Tomorrow / Later) and adds a nav count badge. Read-time only. Kept as
input to the notifications project, whose calendar view and icon cover the
same ground. **Before it could ever merge:** its migration version
`20260921100000` is already taken in production by P26 and must be renamed,
and its test `011_…` collides with P29's.

The plan below is kept for that project to reuse — in particular the
`notification_deliveries` dedup-key design (D-2) and the push constraints
(D-3), which apply to every reminder kind, not just appointments.

**Decision D9 (revised 2026-09-20): in-app reminders AND Web Push. No
email.** Push is built as a **reusable channel**, not as appointment-specific
code — appointment reminders are its first consumer, and adding a second kind
later should be a payload builder plus a preference row, nothing more.

**D10: `web-push` is approved** as a new production dependency under
CLAUDE.md rule 11. Server-only; never imported from a client component.
Rationale: VAPID ES256 signing plus ECDH/HKDF/aes128gcm payload encryption
hand-rolled is ~300 lines of crypto that fails *silently on device* when
subtly wrong. Update CLAUDE.md's locked-stack line when it lands.

#### D-1. In-app bands (no new infrastructure)

Derived at read time from `appointments.scheduled_for` + `status`, which
Phase B already guarantees. No table, no cron, no stored state.

1. **My Day shows appointments before the day they fall on.** Today
   `my_followups` filters `appointment_at::date <= p_as_of`, so an
   appointment is invisible until its own date. Widen that to a forward
   window and band the queue:
   - **Starting soon** — within the next 2 hours, pinned at the top with a
     distinct treatment. This replaces what the "2h before" email would have
     done.
   - **Today** — the rest of today, with times.
   - **Tomorrow**, then **Later this week**, collapsed by default.
   - **Needs an outcome** — `scheduled_for` in the past, status still
     `scheduled`. This is the nag that stops stale appointments accumulating
     and quietly diluting the no-show rate (§1 F3/F10 context).
2. **Count badge** on the My Day item in `rail-nav.tsx` and `tab-bar.tsx` —
   unresolved items due today plus anything in "Needs an outcome", so the
   number is actionable rather than decorative.
3. **Empty states** per band, per `10-journeys.md`.

#### D-2. Web Push — reusable channel

**What already exists:** `/sw.js` is a Route Handler
(`src/app/sw.js/route.ts`) doing app-shell caching only — **no `push` or
`notificationclick` handler**. A PWA manifest exists (`src/app/manifest.ts`),
and its comments show iOS Add-to-Home-Screen was already considered.
`notification_log`, `notification_prefs`, the `enqueue → drain → route`
cron pipeline and an unsubscribe-token module all exist, all email-shaped.

**What must NOT be reused as-is:** `notification_log` carries
`UNIQUE (agent_id, kind, local_date)` (baseline:2168) plus a CHECK pinning
`kind` to the three live values. That unique key encodes *one notification of
a kind per agent per day* — correct for a digest, wrong for appointments,
where an agent can have four in a day. Overloading it would either drop
reminders or force the CHECK and the key open under the three live email
kinds. **Leave `notification_log` untouched** so nothing currently in
production can regress.

**New, generic, reusable pieces:**

1. **`push_subscriptions`** — `agent_id`, `org_id`, `endpoint` (unique),
   `p256dh`, `auth`, `user_agent`, `created_at`, `last_seen_at`,
   `failure_count`, `disabled_at`. One agent → many devices. RLS: agent
   reads/writes only its own; sending is service-role. `org_id` per rule 8.
2. **`notification_deliveries`** — the channel-agnostic delivery log that
   `notification_log` cannot be: `agent_id`, `org_id`, `channel`
   (`push`/`email`/`in_app`), `kind`, `entity_id` (nullable),
   `dedup_key` (text, NOT NULL), `sent_at`, `status`, `attempts`,
   `last_error`, with `UNIQUE (agent_id, channel, dedup_key)`.
   The dedup key is the reusable part:
   - appointment reminder → `appointment:<id>:evening` / `appointment:<id>:t2h`
   - a future daily kind → `evening_nudge:2026-09-20`

   Per-entity and per-day kinds both dedup correctly with no schema change.
3. **`notification_channel_prefs`** — `(agent_id, kind, channel, enabled)`.
   `notification_prefs`' column-per-kind shape does not scale and is wired
   into the live settings page and unsubscribe flow, so it is **left alone**;
   new kinds and channels use this table. Migration path for the three legacy
   booleans is documented, not executed.
4. **`src/lib/notifications/push/`** — `vapid.ts` (key load + validation),
   `send.ts` (`sendPushToAgent(agentId, { kind, dedupKey, title, body, url,
   tag })`, fans out to every live subscription, prunes dead ones),
   `subscribe.ts` (client-side subscribe/unsubscribe/resync). Nothing in this
   module knows what an appointment is.
5. **Service worker** — add generic `push` and `notificationclick` handlers
   to `SW_SOURCE`, reading `{ title, body, url, tag }` from the payload.
   Click focuses an existing client if one is open, else opens `url`.
6. **Scheduling** — a `private.due_push_notifications()` returning rows to
   send, drained by a cron route in the existing `ping_app_route` pattern.
   DB decides *what is due*, app *sends* — consistent with how the email
   pipeline is already split. 5-minute granularity is sufficient for both
   lead times.

**Lead times:** evening before (~18:00 agent-local) and T-2h. Both
per-agent-timezone, both individually toggleable.

#### D-3. Constraints that must be designed for, not discovered

- **iOS is the big one.** Safari on iOS/iPadOS supports Web Push only from
  16.4+, and **only when the app has been added to the Home Screen** — never
  in a normal Safari tab. For a field-sales app this is most of the user
  base. Required: a capability check that distinguishes "not supported",
  "supported but you must install the app first", and "you denied
  permission", each with its own explanation. Silently showing a dead toggle
  is not acceptable. Pairs with an A2HS prompt in onboarding.
- **Permission must follow a user gesture.** Never prompt on page load. A
  card on My Day ("Get reminded before your appointments") plus a Settings
  toggle. `denied` is sticky and unrecoverable in-app — detect it and say so.
- **Subscriptions expire.** 404/410 from the push service → delete the row.
  429 → backoff. Repeated other failures → `failure_count`, disable after N.
  Re-sync `pushManager.getSubscription()` against the server on app load.
- **No prospect PII in a push payload.** A push body renders on a lock
  screen and is stored by the OS. "Appointment at 2:00 PM" ships; "Appointment
  with John Smith" does not. This follows the spirit of rule 2 and belongs in
  `04-security.md` as a standing rule for every future kind, not a one-off
  choice for this one.
- **VAPID keys.** Private key is server-only env (`VAPID_PRIVATE_KEY`); the
  public key is *designed* to be public and correctly lives in
  `NEXT_PUBLIC_VAPID_PUBLIC_KEY`. Confirm `ci.yml`'s service-key leak gate
  neither false-positives on the public one nor ignores the private one. Per
  CLAUDE.md's staging gotcha, re-verify both in Vercel whenever the Supabase
  `staging` branch is recreated.

**Revert:** D-1 is read-time only — revert the deploy. D-2 reverts by
disabling the cron job; the tables are additive and inert, and
`notification_log` was never touched, so the three live email kinds are
unaffected either way.

---

### Phase E — Contract — ON HOLD

Not required for correctness. The duplicate `appointment_at` columns remain,
and the trigger keeps them consistent; N1 shows the cost of keeping them.
Revisit if they cause another defect. Original plan:

Only after Phases A–D have been stable on `master` for a full 10-day cycle.

- Stop writing `call_logs.appointment_at` / `appointment_done_at`; retire
  `appointments.appointment_at`.
- Consider making `appt_date` a true generated column.
- Retire the `not exists` legacy clause **only if** D4 is revisited.

---

## 6. Existing-data migration

The part most likely to go wrong. Rules:

1. **Snapshot first.** `scripts/metrics-snapshot.sql` against production and
   staging, committed as a CSV artifact on the PR. Every backfill's diff is
   reviewed against it before promotion.
2. **Quantify the loss before fixing it.** Before Phase A, count
   agent-days where appointments exist but no `daily_metrics` row does
   (F1 victims), and where call logs were purged (F2, unrecoverable). This
   number goes in the Phase A PR body and in the §9 comms.
3. **Never recompute inline.** Backfills insert into `private.metrics_dirty`
   and let the existing `drain-metrics` cron (every minute, 1000/batch) do
   the work. This is the "no impact" mechanism — it reuses the exact path
   that already runs in production, at its existing rate, instead of a long
   transaction holding locks.
4. **Batch every UPDATE.** `do $$ loop ... limit 5000 ... end loop $$` with
   a progress notice. No single statement rewrites the table.
5. **Idempotent.** Every backfill is written to be safe to run twice —
   `where col is null` or a full recompute from source, never `col = col +
   x`. (The P24 backfill got this right and it is the reason it can be
   re-run; keep the pattern.)
6. **Verify coverage before tightening.** `set_on` becomes `NOT NULL` only
   after `select count(*) from appointments where set_on is null` = 0.
7. **Order matters.** Phase A's `appts_set` backfill must complete before
   Phase B's `set_on` backfill, or the two definitions interleave.

**Backfill sources:**

| Column | Source | Fallback |
|---|---|---|
| `set_on` | `(created_at at time zone agent.time_zone)::date` | imported rows (`import_row_hash is not null`) → `appt_date` |
| `scheduled_for` | `appointment_at` | null (legacy/imported) |
| `resolved_on` | `appt_date` where status is terminal | null |
| `source_call_log_id` | null (D4 — no retro-linking) | — |
| `rescheduled_to_id` | null (no reliable historical signal) | — |

Offline-created rows are indistinguishable from online ones; `set_on` takes
the sync-day value (F14 accepted for history, fixed going forward in Phase C
by submitting the client's own date).

---

## 7. Edge case register

Every one of these gets a test (§8).

**Dates & time zones**
- E1 Appointment set and resolved the same day → one `set_on`, one
  `resolved_on`, both on that day.
- E2 Set in cycle N, held in cycle N+1 → Set counts in N, Held in N+1.
  **They do not reconcile within a cycle.** Documented in `08-screen-specs.md`;
  a cohort conversion metric is out of scope.
- E3 Agent changes `time_zone` after booking → `set_on` is a stored date, so
  history is immutable. This is the main argument for the column.
- E4 Booking near local midnight; DST transition on the appointment date.
- E5 `scheduled_for` in the past at creation (backdated entry) — allowed,
  must not be treated as overdue-unresolved on day one.
- E6 Resolution recorded days after the fact → `resolved_on` is the
  recording day, not the appointment day. Deliberate, and documented.

**Lifecycle**
- E7 Resolve → undo → resolve again; `resolved_on` must not accumulate.
- E8 Terminal row edited (notes only) must not change any bucket.
- E9 Reschedule successor itself cancelled.
- E10 Reschedule successor deleted → predecessor's `rescheduled_to_id` goes
  null (FK `ON DELETE SET NULL`); predecessor must not silently re-enter the
  denominator.
- E11 Reschedule chain depth cap and cycle guard (A→B→A must be rejected).
- E12 Held with no `appt_type` (legacy/imported) → existing guard applies.
- E13 Two appointments for the same contact at the same `scheduled_for`.
- E14 Appointment whose contact is deleted → cascade fires the metrics
  trigger; the day must recompute, not go stale.

**Concurrency & delivery**
- E15 Offline replay of a pre-Phase-C FormData shape against a post-Phase-C
  action — **the queue survives deploys**, so the action must accept the old
  field set. Non-negotiable for "no impact".
- E16 Duplicate submit via `client_request_id` must not create a second
  appointment *or* a second `appts_set` event.
- E17 Two devices resolving the same appointment simultaneously.
- E18 A drain running mid-backfill (guaranteed — the cron is every minute).
  Recompute must be idempotent under interleaving; `002` already asserts
  idempotence for calls, `007` extends it to appointments.

**Security (CLAUDE.md rules 1, 2, 8)**
- E19 `set_on`/`scheduled_for` not updatable by the owning agent after
  creation — grants + trigger, not a policy.
- E20 `source_call_log_id` / `rescheduled_to_id` must not permit
  cross-agent or cross-org linking. FK + trigger check on `agent_id`/`org_id`.
- E21 No new RPC returns `contact_name`/`notes` across the hierarchy.
- E22 New RPCs: `set search_path = ''`, fully-qualified names, `private`
  schema unless RPC-callable, and revokes naming `PUBLIC, anon,
  authenticated` explicitly (rule 4 — this has bitten twice).

**Retention**
- E23 Purge must not alter `daily_metrics` (F2's fix) — asserted directly.
- E24 Appointments are not purged; only call logs are. A purged call whose
  appointment row survives must keep counting.

**Push (Phase D)**
- E25 Reminder fires once per appointment per lead time, never twice —
  including across a cron overlap or a retry (`dedup_key` uniqueness).
- E26 Appointment resolved, cancelled, deleted or rescheduled *after* the
  reminder was queued but before it sends → **do not send**. Check current
  status at send time, not enqueue time.
- E27 Reschedule moves the time → the successor gets its own reminders; the
  predecessor's are cancelled.
- E28 Multi-device: one agent, three devices → one notification each, and one
  dead endpoint must not block the other two.
- E29 Subscription expired (404/410) → row deleted, no retry storm.
- E30 Permission `denied`, or iOS Safari not installed to Home Screen → the
  toggle explains *which* case it is; never a dead control.
- E31 Same account signed in on a shared/borrowed device — unsubscribe on
  sign-out so reminders don't follow the agent to someone else's phone.
- E32 Payload contains no contact name or notes (lock-screen PII).
- E33 Agent changes time zone between enqueue and send → lead times
  recompute from the agent's current zone.
- E34 Push send path is never reachable from a client component; VAPID
  private key never crosses the boundary.
- E35 Appointment in the past at creation (backdated) must not fire a
  retroactive reminder.

---

## 8. Test plan

Fills the F17 gap. Priority per `05-testing.md`: RLS > integration > unit > E2E.

**pgTAP — new `supabase/tests/007_appointment_lifecycle.sql`**
- One assertion per status transition, against `daily_metrics` directly.
- `appts_set` invariant: **never decreases** when a row is resolved (F3).
- Dedup: a call log with a linked appointment counts once (F4).
- Delete guard: a day with only a cancelled appointment keeps its row (F1).
- Retention: `purge_old_call_logs` leaves `daily_metrics` unchanged (F2).
- Fuzz, mirroring `002`'s existing pattern: `appts_set` matches a
  from-scratch count over both sources for every touched day.
- E1–E14, E23, E24.

**pgTAP — extend `002_daily_metrics_pipeline.sql`**
- Its date-boundary and idempotence tests currently run only through
  `call_logs`; add the appointment equivalents (E18).
- Extend the "row cleaned up, not stuck" test so it can't re-encode F1.

**pgTAP — extend `001_rls_and_hierarchy.sql`**
- E19, E20, E21 — including the negative case for the immutability trigger.

**Vitest**
- `appointments/actions.test.ts` — **new, none exists today.** Status
  transition matrix, future-date guard, `resolved_on` assignment, reschedule
  lineage, E16.
- `metrics.test.ts` — replace the `pipelineValueOpenAppts` fixtures, which
  currently assert on rows the UI cannot produce (F7).
- `dates.test.ts` — E3, E4.
- `commit-import.test.ts` — `created_at`/`set_on` from `appt_date` (F5).
- Offline queue — E15 old-shape replay.

**Push (Phase D)**
- pgTAP: `push_subscriptions` RLS (agent sees only its own, anon sees none,
  no cross-org read); `notification_deliveries` dedup uniqueness; the
  due-window function returns nothing for resolved/cancelled/deleted
  appointments (E26) and nothing for backdated ones (E35).
- Vitest: dedup-key builder; payload builder asserts **no contact name or
  notes** (E32) — this one is a privacy regression test, not a nicety;
  subscription pruning on 404/410 (E29); capability detection branches for
  iOS-not-installed vs denied vs unsupported (E30); VAPID config validation
  fails loudly on a missing/malformed key.
- Service-key leak gate: extend `ci.yml`'s grep so `VAPID_PRIVATE_KEY` can
  never appear in a client bundle, and so it does not false-positive on
  `NEXT_PUBLIC_VAPID_PUBLIC_KEY`.
- Manual: real-device matrix — Android Chrome, desktop Chrome/Edge, macOS
  Safari, and iOS Safari **installed to Home Screen**. Push cannot be
  meaningfully covered by Playwright; the device pass is the gate.

**Playwright** — the `e2e/` directory does not exist; P25 is a reasonable
place to start it, with the one journey that covers the most surface:
book from a call → appears in Upcoming → reminder → resolve as Held →
dashboard reflects it. Worth writing even though the CI job is
`continue-on-error`.

**CI:** `007` joins `npm run test:rls` automatically (the runner globs
`supabase/tests/*.sql`). No workflow change needed. Note `ci.yml:74-75`
already blocks on vitest — `05-testing.md` says otherwise and is stale.

---

## 9a. What Phase A actually did — production record (2026-09-20)

Kept so a future "why did my number change on that day?" is answerable
without re-deriving it.

**Nothing was lost.** `metrics-damage-report.sql` before the migration:
F1 = 0 and F2 = 0 across all five orgs, oldest call anywhere `2026-08-08`
against a `2024-09-20` purge horizon. Production's call volume happened to
keep appointment days alive; **staging was not so lucky and had lost one
agent-day**, which is the same bug landing for real.

**Seven agent-days were restated, every one upward** (all `F3 restore`; no
`F5` rows, since production carries no imported appointments):

| Agent | Date | Was | Now |
|---|---|---|---|
| Abhinav Kamsali | 2026-09-03 | 0 | 1 |
| Harkaran Singh | 2026-09-15 | 0 | 1 |
| Srinath Reddy Yellugari | 2026-09-09 | 0 | 1 |
| Srinath Reddy Yellugari | 2026-09-16 | 0 | 1 |
| Sukhvir Singh | 2026-09-16 | 0 | 2 |
| *Sample Associate One* (demo) | 2026-08-24 | 1 | 2 |
| *Sample SMD* (demo) | 2026-08-29 | 0 | 1 |

Four real agents, five days, +6 Appts Set.

**`daily_metrics` went 124 → 122.** Not a loss. The migration re-marked
every row dirty, so rows whose counters had long since dropped to zero —
and which nothing had re-marked since — were finally cleaned up. The new
guard deletes *fewer* rows than the old one (it requires every counter to
be zero, not five of them), so a drop cannot come from over-deleting.
Confirmed after the fact: zero days with real source activity lack a row,
and zero all-zero rows remain.

Post-migration verification, production and staging both: F1 recoverable
agent-days 0, `appts_set` mismatches 0, `metrics_dirty` 0.

## 9. Communicating the metric restatement

`appts_set` and the no-show rate change for **historical** periods (D8, D3).
Agents and SMDs will see past numbers move. Untold, this reads as a bug and
costs trust in the tool.

- Announce via the existing `announcements` table before the Phase A
  promotion to `master`.
- State: what changed, which direction, and that the new numbers are the
  correct ones.
- Include the F1/F2 loss figure from §6 step 2 — days that cannot be
  recovered should be named, not quietly left as zeroes.
- Keep the pre-change snapshot CSV so any "it used to say X" question is
  answerable.

---

## 10. Documentation updates

Part of each phase's DoD, not a cleanup pass afterwards.

| File | Change | Phase |
|---|---|---|
| `02-data-model.md` | New columns, the §3 metric contract, the status machine, the `appt_date` compatibility trigger | B |
| `05-testing.md` | `007` suite; **fix the stale CI paragraph** (vitest blocks, `ci.yml:74`); record that `002` covers calls only | 0, A |
| `06-build-phases.md` | P25 entry, phases A–E with tick boxes | A |
| `08-screen-specs.md` | Upcoming section, resolve sheet, corrected no-show formula, Open Pipeline, the E2 cycle caveat | C |
| `10-journeys.md` | Book → remind → resolve; the reschedule journey; per-band empty states | C, D |
| `03-ui.md` | Resolve sheet component + tokens; My Day band treatments; nav count badge | C, D |
| `08-screen-specs.md` | My Day bands (Starting soon / Today / Tomorrow / Later / Needs an outcome) and the badge rule | D |
| `04-security.md` | **No prospect PII in a push payload** as a standing rule for every future kind; VAPID key handling; `push_subscriptions` RLS | D |
| `09-account-and-auth.md` | Settings: push toggle + per-lead-time toggles; the three capability states (unsupported / install-to-Home-Screen / denied); unsubscribe-on-sign-out | D |
| `CLAUDE.md` | Add `web-push` to the locked stack; note that `notification_log` is for daily-digest kinds and `notification_deliveries` for per-entity ones | D |
| `01-requirements.md` | Appointment lifecycle user stories | C |
| `00-open-questions.md` | Record D1–D8 as decided, with dates | A |
| `11-incident-response.md` | Runbook for a bad backfill: snapshot → re-mark dirty → drain | A |
| `CLAUDE.md` | New gotcha: *a read model's delete guard must name every counted column*; the `appts_set` definition as the single source of truth | A |
| `TODOS.md` | F-numbers with phase assignment | 0 |

`ui-mockup.html` is already flagged stale (dark theme) and is out of scope.

---

## 11. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Backfill corrupts `daily_metrics` further | Med | High | Snapshot + idempotent recompute-from-source + staging rehearsal with a production-shaped dataset |
| Phase A's purge fix suppresses legitimate recomputes | Med | Med | GUC scoped to the purge transaction only; E23/E24 assert both directions |
| Offline queue replays a stale shape post-deploy | Med | Med | E15; actions accept both shapes through Phase D |
| Reschedule lineage creates loops | Low | Med | E11 cycle guard + depth cap |
| `set_on NOT NULL` fails on a straggler row | Med | Low | Coverage check gates the constraint (§6 step 6) |
| Metric restatement reads as a bug | **High** | Med | §9 comms before promotion |
| Phase C's UI lands with Phase B unmigrated | Low | High | Phase C reads only columns Phase B guarantees `NOT NULL`; CI asserts the migration order |
| `staging` Supabase branch env drift | Med | Med | CLAUDE.md's known gotcha — re-verify `NEXT_PUBLIC_*` against the branch's live API settings before trusting a staging result |
| iOS agents can't receive push (not installed to Home Screen) | **High** | Med | Treated as a first-class UI state, not an error; A2HS prompt in onboarding; in-app bands (D-1) still work for everyone, so push is additive reach rather than the only channel |
| Prospect name reaches a lock screen | Low | **High** | E32 payload test is a blocking privacy regression test; rule written into `04-security.md` for all future kinds |
| Reminder fires for an appointment already cancelled | Med | Med | E26 — status checked at send time, not enqueue time |
| Push send path leaks the VAPID private key clientward | Low | High | `server-only` import in the push module + extended `ci.yml` leak gate (E34) |

---

## 12. Sequencing summary

```
Phase 0  characterization tests + snapshot        — no prod change
Phase A  metrics integrity (F1,F2,F3,F4,F5)       — DB + import, no UI      ◀ urgent
Phase B  additive schema + dual write (F8,E3)     — DB + actions, no UI
Phase C1 single record (call creates it, My Day    — invisible half  ✔
         reads it) (F4,F11,F12)
Phase C2 lifecycle UI: resolve sheet, Upcoming,    — the visible change ✔
         Open Pipeline (F6,F7,F9,F10,F15,F16)
P29      appointment flow fixes N1–N7              — after C  ✔
Phase D  in-app bands + Web Push (F13)            — moved to notifications project
Phase E  contract                                 — on hold
```

Phases 0 and A should ship together and promote to `master` ahead of the
rest. Everything after that can proceed at normal pace.
