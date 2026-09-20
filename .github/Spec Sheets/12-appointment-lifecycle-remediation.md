# P25 — Appointment lifecycle remediation

**Status:** plan, not yet implemented. Written 2026-09-20 after an end-to-end
review of the appointment record/status/date flow and its effect on
`daily_metrics`.

**Why this exists:** P23 and P24 each redefined `appts_set` and shipped a
backfill against a read model with no behavioural test coverage for
appointments. Two of the resulting defects destroy data rather than
misreport it. This document is the remediation plan, sequenced so that
nothing user-visible breaks at any point and every step is independently
revertible.

Read with: `02-data-model.md` (schema/RPC contracts), `05-testing.md` (test
plan), `08-screen-specs.md` (per-page KPIs), `06-build-phases.md` (where P25
sits).

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
| D9 | **Appointment reminders are in-app only. No email.** | Requested 2026-09-20. Removes the Resend template, the new notification kind, the cron job and the per-kind unsubscribe surface from scope entirely. Trade-off in Phase D. | Low — the email path can be added later without changing anything built in Phase D. |

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

### Phase A — Stop the bleeding (DB only, no app change)

Fixes F1, F2, F3, F4, F5. This is the urgent one — F1 and F2 lose data every
day they ship.

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

### Phase B — Additive schema + dual write (no UI change)

Fixes F8's data loss and the time-zone drift; makes Phase C possible.

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

### Phase C — Single record + lifecycle UI

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

### Phase D — In-app reminders (F13)

**Decision D9: in-app only. No email.** No new notification kind, no
`enqueue_due_notifications` change, no Resend template, no cron job, no
unsubscribe handling, no new table. Everything below is derived at read time
from `appointments.scheduled_for` + `status`, which Phase B already
guarantees.

This is materially cheaper than the email version and removes the whole
P14a per-kind unsubscribe surface from scope.

**What exists today:** no in-app notification centre. The only persistent
in-app surface is `AnnouncementBanner` (admin-authored, platform-wide, not
per-agent). `sonner` toasts are transient. `/sw.js` is registered but has no
push handler.

**What gets built:**

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

**Accepted limitation, stated plainly:** an in-app reminder only reaches the
agent when they open the app. An 8am appointment gets no 6pm-the-night-before
nudge unless they happen to open Kautis that evening. This is a deliberate
trade (no inbox noise, no email infrastructure, no unsubscribe compliance
surface) and it still fixes the core defect — the appointment is *visible in
advance* instead of invisible until the day. If reach-while-closed is wanted
later, web push through the already-registered service worker is the natural
add-on and is a self-contained follow-up; it does not change anything in this
phase.

**Revert:** app-only. Revert the deploy; the banding is a read-time concern
with no stored state.

---

### Phase E — Contract

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

**Playwright** — the `e2e/` directory does not exist; P25 is a reasonable
place to start it, with the one journey that covers the most surface:
book from a call → appears in Upcoming → reminder → resolve as Held →
dashboard reflects it. Worth writing even though the CI job is
`continue-on-error`.

**CI:** `007` joins `npm run test:rls` automatically (the runner globs
`supabase/tests/*.sql`). No workflow change needed. Note `ci.yml:74-75`
already blocks on vitest — `05-testing.md` says otherwise and is stale.

---

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

---

## 12. Sequencing summary

```
Phase 0  characterization tests + snapshot        — no prod change
Phase A  metrics integrity (F1,F2,F3,F4,F5)       — DB + import, no UI      ◀ urgent
Phase B  additive schema + dual write (F8,E3)     — DB + actions, no UI
Phase C  single record + lifecycle UI             — the visible change
         (F6,F7,F9,F10,F11,F12,F15,F16)
Phase D  in-app reminders (F13)                   — My Day bands + badge
Phase E  contract                                 — after one clean cycle
```

Phases 0 and A should ship together and promote to `master` ahead of the
rest. Everything after that can proceed at normal pace.
