# P25 Phase C — manual steps and staging verification

Companion to `12-appointment-lifecycle-remediation.md`. That file is the
plan and the record of what was decided; this one is the runbook for
getting Phases C1 and C2 from a feature branch onto `master` without
breaking anything, and the script for proving on `staging` that it works.

**What is being promoted**

| Migration | Phase | What it does |
|---|---|---|
| `20260920140000_p25c1_call_creates_appointment.sql` | C1 | `my_followups` reads `appointments`; unique `source_call_log_id` |
| `20260920150000_p25c2_reschedule_and_overdue.sql` | C2 | reschedule chain guards; `days_late` from `greatest(due, set_on)` |

Plus app changes across `log/`, `today/`, `appointments/`, `dashboard/`,
`lib/metrics.ts`, `lib/dates.ts`.

**Neither migration moves a stored number.** Verified against production
before promotion — see §1.4. That is the single most important fact here:
if a `metrics-snapshot` diff shows anything at all, stop.

---

## 0. Before you start

- [ ] You are on `claude/zen-ritchie-k4zo9u` and it is pushed.
- [ ] `origin/dev`, `origin/staging` and `origin/master` are in sync with
      each other. They were at `fa44b24` when this branch was cut. If they
      have diverged since, fix that **first** — CLAUDE.md's gotcha about
      "Already up to date" lying against a stale local copy applies, so
      `git pull` each one before trusting it.
- [ ] Re-verify the `staging` Vercel env vars against the Supabase staging
      branch's live `Settings → API` values (`NEXT_PUBLIC_SUPABASE_URL`,
      `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`). The
      project ref changes every time that branch is recreated, and
      `NEXT_PUBLIC_*` values are baked into the bundle at build time — a
      stale ref means you will spend an hour testing against a deleted
      database.

---

## 1. Manual steps

### 1.1 Review the two migrations

Read them in full before applying anything. Both have a header explaining
what they do and a footer with the revert. Specifically check:

- [ ] `20260920140000` — the `DROP INDEX` / `CREATE UNIQUE INDEX` pair on
      `appointments_source_call_log_idx`. It is only safe because zero rows
      carry `source_call_log_id`. **Confirm that yourself** (§1.4).
- [ ] `20260920150000` — `appointments_rescheduled_to_idx` (unique),
      likewise safe only because zero rows carry `rescheduled_to_id`.
- [ ] Neither file writes to `daily_metrics`, calls `recompute_day`, or
      inserts into `private.metrics_dirty`. Grep them to be sure. Phase A
      and B both did; these deliberately do not, which is why they need no
      rebuild and no restatement announcement.

### 1.2 Take the before-snapshot

Against **production** and **staging**, before anything is applied:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --csv \
  -f scripts/metrics-snapshot.sql > snapshot-before-prod.csv
```

Keep it. It is the artifact that answers "it used to say X" later, and the
diff against the after-snapshot is what you attach to the PR.

### 1.3 Preview the one restatement

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/noshow-restatement-preview.sql
```

- [ ] **Expect zero rows.** That is what production returned on
      2026-09-20: across all 31 agent-cycles ever recorded, not one
      contains a no-show, so the rate reads 0% under both the old formula
      and the new one and nobody's number changes.
- [ ] **If it returns rows**, someone has recorded a no-show since. Put the
      output in the PR body and publish an announcement before promoting
      to `master` (§9 of the plan, and `/admin/announcements` is the UI).
      Do not skip this — a metric that moves without warning reads as a
      bug and costs more trust than the bug did.

### 1.4 Confirm the safety preconditions

```sql
select
  (select count(*) from public.appointments where source_call_log_id is not null) as c1_links,
  (select count(*) from public.appointments where rescheduled_to_id  is not null) as c2_links,
  (select count(*) from public.appointments where status = 'rescheduled')         as rescheduled_rows;
```

- [ ] `c1_links` = 0 and `c2_links` = 0. Both unique indexes fail loudly on
      a duplicate rather than silently, but finding out during a migration
      is worse than finding out now.
- [ ] If either is non-zero, find the duplicates before proceeding:
      `select source_call_log_id, count(*) from public.appointments
       where source_call_log_id is not null group by 1 having count(*) > 1;`

### 1.5 Merge to `dev`

```bash
git checkout dev && git pull origin dev
git merge claude/zen-ritchie-k4zo9u --no-edit
git push origin dev
```

- [ ] CI green on `dev` (`ci (18.x)` and `ci (20.x)`). **This is where
      pgTAP actually runs** — suites `007`–`010` were written but could not
      be executed in the authoring environment, because its network policy
      blocks the Docker registry that `supabase start` pulls from. Treat a
      green `test:rls` step here as the first real proof they pass.
- [ ] If `010_appointment_reschedule.sql` fails, read the failure before
      changing the test. Its chain-cap assertions depend on the cap being
      exactly 10; the "control" assertion (a chain of ten builds cleanly)
      failing means the cap is being hit too early.

### 1.6 Promote to `staging`

```bash
git checkout staging && git pull origin staging
git merge dev --no-edit
git push origin staging
```

- [ ] Apply the migrations to the Supabase **staging branch**. `supabase
      db push` is yours to run, not Claude's — `apply_migration` and
      `execute_sql` are blocked at the tool level.
- [ ] Verify against the **actual database**, not the status field:
      ```sql
      select version from supabase_migrations.schema_migrations
      order by version desc limit 4;
      ```
      You want `20260920150000` and `20260920140000` present. A branch that
      reports `FUNCTIONS_DEPLOYED` with an empty database is a documented
      failure mode of the reset action.
- [ ] Confirm the new objects exist:
      ```sql
      select indexname from pg_indexes
       where tablename = 'appointments'
         and indexname in ('appointments_source_call_log_idx',
                           'appointments_rescheduled_to_idx');
      select tgname from pg_trigger
       where tgrelid = 'public.appointments'::regclass and not tgisinternal;
      ```
      Expect both indexes, and among the triggers:
      `appointments_identity`, `appointments_links_valid`,
      `appointments_reschedule_chain_valid`.
- [ ] Wait for a Vercel deploy of `staging` to finish, and confirm it built
      from the commit you just pushed.

### 1.7 Run §2 on staging

The whole of the next section. Do not skip the parts that look obvious —
F6, F7 and F15 were each a one-line mistake that survived multiple reviews
precisely because they looked obvious.

### 1.8 Take the after-snapshot

```bash
psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 --csv \
  -f scripts/metrics-snapshot.sql > snapshot-after-staging.csv
diff -u snapshot-before-staging.csv snapshot-after-staging.csv
```

- [ ] The diff shows **only** rows you created during §2 testing. Any
      change to an agent-day you did not touch by hand is a bug — stop and
      investigate. Neither migration is supposed to move a stored number.

### 1.9 Promote to `master`

`master` is protected: PR only, no direct push, no bypass.

- [ ] Open a PR `staging` → `master`. Put in the body: the snapshot diff,
      the no-show preview output (even if empty — "zero rows" is the
      finding), and the §1.4 precondition counts.
- [ ] Both `ci (18.x)` and `ci (20.x)` green.
- [ ] Merge.
- [ ] Apply the migrations to the **production** Supabase project.
- [ ] `npm run types` and commit the result if it differs. It should not —
      C1's types were regenerated already and C2 adds no columns — but
      check rather than assume.

### 1.10 Re-sync, in the same sitting

```bash
git checkout dev     && git pull origin dev     && git merge master --no-edit && git push origin dev
git checkout staging && git pull origin staging && git merge master --no-edit && git push origin staging
```

- [ ] Verify by checking real file content, not the git output. "Already up
      to date" lies if your local `master` was stale.

---

## 2. Staging test plan

Set up one test agent with a known time zone. Everything below is from
that agent's login unless it says otherwise.

Times matter in several of these. Where a step says "for tomorrow" it
means a real future date, not today.

### 2.1 C1 — the call creates the appointment (F4, F11)

| # | Do | Expect |
|---|---|---|
| 1 | `/log`, Call tab. Log a call, outcome **Appointment set**, date/time tomorrow 2:00 PM, leave Type alone | Saves. Toast "Call logged" |
| 2 | Open `/appointments` | A **scheduled** row for that contact, tomorrow's date, type **Follow Up** |
| 3 | Open `/today` | The appointment is **not** there yet (it is tomorrow) |
| 4 | Dashboard → Appts Set for today | **+1**, not +2. This is F4. If it says 2, the dedup clause is not matching and `source_call_log_id` is not being written |
| 5 | Log another call, outcome Appointment set, type **Solutions Presentation** | `/appointments` shows that type, not Follow Up |
| 6 | `/logs` → edit the first call → change the appointment time to 4:00 PM → save | `/appointments` shows 4:00 PM. The appointment followed the call |
| 7 | Edit that call again → change outcome to **Voicemail** → save | The scheduled appointment is **gone** from `/appointments`. Appts Set for today drops by 1 |
| 8 | Edit it back to Appointment set, tomorrow 3:00 PM | The appointment is recreated |

**Then check the database directly** (this is the half no screen shows):

```sql
select ap.id, ap.set_on, ap.scheduled_for, ap.appt_date, ap.status,
       ap.source_call_log_id is not null as linked, cl.call_date
from public.appointments ap
left join public.call_logs cl on cl.id = ap.source_call_log_id
order by ap.created_at desc limit 5;
```

- [ ] `linked` is true for every call-created appointment
- [ ] `set_on` equals the **call's** `call_date`, not today, when you
      back-dated the call
- [ ] `appt_date` equals `scheduled_for`'s date in the agent's zone

### 2.2 C1 — My Day reads appointments (F11, F12)

| # | Do | Expect |
|---|---|---|
| 1 | Log a call with an appointment set for **today**, an hour from now | `/today` shows it, "Appointment · 3:00 PM" |
| 2 | Check it appears **once** | Twice means `my_followups`' dedup clause is not matching. This is the single most likely C1 regression |
| 3 | Row menu | Snooze 1 day · Snooze 1 week · **Held…** · No-show · Cancelled · **Reschedule…** |
| 4 | Snooze 1 day | Leaves today's queue. `/appointments` shows tomorrow, **same time of day** |
| 5 | Tap **No-show** | Leaves the queue. `/appointments` shows No-show |
| 6 | Query `select resolved_on from public.appointments where id = ...` | **Today**, not the appointment's own date. This is E6 |
| 7 | On a **resolved** appointment, edit it and set a follow-up date of today | It appears in `/today` as its own queue item. This is F12, which had never worked |
| 8 | Mark that follow-up done | It leaves the queue |

### 2.3 C2 — the resolve sheet (Held)

| # | Do | Expect |
|---|---|---|
| 1 | From `/today`, on a pending appointment, choose **Held…** | Sheet opens, prefilled with the appointment's existing type and premium |
| 2 | Set premium 1200, referrals 2, a note. Save | Toast "Marked held". Row leaves the queue |
| 3 | `/appointments` | Status Held, premium $1,200, referrals 2 |
| 4 | Dashboard → Appts Held **today** | +1, on today, regardless of which day the appointment was for |
| 5 | Set an appointment's type to **Application** in the sheet | "Log as a Sale" appears with a product type select |
| 6 | Check it, pick a product, save | Toast "Marked held, sale logged". `/sales` has the sale, dated today, at the premium you entered |
| 7 | On `/appointments`, change a **pending** row's status dropdown to Held | The **same sheet** opens. It must not write a bare status |
| 8 | On an **already-held** row, change the dropdown to No-show | Changes directly, no sheet. Query `resolved_on` — it must **not** have moved to today |
| 9 | Try to mark held an appointment with **no type** (an imported one) | Refused with "Select an appointment type…", or the sheet makes you pick one |

### 2.4 C2 — reschedule (F9, D1, D2, E11)

| # | Do | Expect |
|---|---|---|
| 1 | On a pending appointment, choose **Reschedule…** | Picker opens, **prefilled with the slot it is moving from** — not today |
| 2 | Move it a week out. Save | Toast. `/appointments` now shows **two** rows: the original as **Rescheduled**, a new **Scheduled** one for the new date |
| 3 | Dashboard → Appts Set **today** | **+1** for the rebooking (D2). The original's own Appts Set stays on the day it was first booked |
| 4 | `/appointments` → No-show rate | The reschedule contributes **nothing** to it (D3) |
| 5 | Check the premium carried over | The successor has the same expected premium. Open Pipeline must not drop because a prospect moved |
| 6 | Query the link | `select id, status, rescheduled_to_id from public.appointments where ...` — the original points at the successor |
| 7 | Double-tap Reschedule on the same original (or resubmit) | **One** successor, not two |
| 8 | Try to reschedule an **already-held** appointment | Refused |
| 9 | Delete the successor | The original's `rescheduled_to_id` goes null, and it **stays** Rescheduled — it must not revert to pending (E10) |

**Cycle and depth guards** (SQL, since no UI can reach them):

```sql
-- Should raise: cycle
update public.appointments set rescheduled_to_id = '<original-id>'
 where id = '<successor-id>';

-- Should raise: unique violation
update public.appointments set rescheduled_to_id = '<successor-id>'
 where id = '<some-third-appointment>';
```

- [ ] Both raise. If either succeeds, the C2 trigger or index did not apply

### 2.5 C2 — Open Pipeline (F7)

| # | Do | Expect |
|---|---|---|
| 1 | `/appointments/new`, status **Scheduled** | An **Expected premium** field is visible, with the hint about Open Pipeline |
| 2 | Enter 2500, save | `/appointments` → Open premium includes $2,500 |
| 3 | Dashboard → Open Pipeline / pipeline value | Non-zero, and matches |
| 4 | Before this release it was $0 | If it is still $0, the field is being shown but not submitted — check `expectedPremiumCents` in the form payload |

### 2.6 C2 — no-show rate (F10)

| # | Do | Expect |
|---|---|---|
| 1 | In one cycle, create: 2 held, 1 no-show, 1 cancelled, 3 scheduled, 1 rescheduled | |
| 2 | `/appointments` → No-show rate | **25%** (1 of 4), and the tile's hint reads "1 of 4 resolved" |
| 3 | Dashboard → no-show | **The same 25%.** These two screens disagreed before this release; that is the whole of F10 |
| 4 | Add 5 more scheduled appointments | The rate does **not** move. Pending appointments are not outcomes |
| 5 | Resolve one scheduled → held | Rate becomes 1 of 5 = 20% |

### 2.7 C2 — Upcoming and Needs-an-outcome

| # | Do | Expect |
|---|---|---|
| 1 | With an appointment booked for **next month**, set the period filter to the current cycle | It appears under **Upcoming**, above the filters, even though the table below excludes it |
| 2 | An appointment dated **yesterday**, still scheduled | Appears under **Needs an outcome** with its explanation |
| 3 | An appointment for **2pm today**, checked at 10am and again at 3pm | Under **Upcoming** both times. The split is on the calendar day, not the clock |
| 4 | Resolve everything | Both bands disappear entirely |

### 2.8 C2 — the edit form (F6, F15)

| # | Do | Expect |
|---|---|---|
| 1 | Import an appointment (or create one in SQL with `appointment_at` and `scheduled_for` null) dated last month, status scheduled | |
| 2 | Open it in the edit form | The date field shows **last month**, not today. This is F6 |
| 3 | Change only the notes. Save | `/appointments` still shows last month. Before this release it silently jumped to today |
| 4 | Create an Application appointment, status Held, "Log as a Sale", dated the 10th | Sale is dated the 10th |
| 5 | Edit it, change the date to the 12th, save | The **sale** is also dated the 12th. This is F15 — it used to keep the 10th |

### 2.9 C2 — delete guard (F16)

| # | Do | Expect |
|---|---|---|
| 1 | Delete an appointment with **no** linked records | Deletes immediately, no dialog |
| 2 | Delete one that produced a sale | Dialog: "This appointment created a sale", naming the premium, with **Keep it** and **Delete both** |
| 3 | Choose **Keep it** | Appointment gone, sale still on `/sales`, `sales_count` unchanged |
| 4 | Repeat, choose **Delete both** | Both gone, `sales_count` down by 1 |

### 2.10 Regression — the things C1/C2 could have broken

| # | Do | Expect |
|---|---|---|
| 1 | Log a call with outcome Connected and a callback date | Still appears in `/today` as a plain follow-up, with **Mark done** (not the resolve items) |
| 2 | Snooze and mark-done a plain follow-up | Unchanged behaviour |
| 3 | An appointment logged directly at `/appointments/new`, status Held, back-dated | Appts Held lands on **that date**, not today. The form has a date field; the quick-resolve path does not. This difference is deliberate |
| 4 | Go offline (devtools), log a call with an appointment set, come back online | Syncs. The appointment is created, and `set_on` is the day you **logged** it |
| 5 | SMD login → team pages | Appts Set / Held / no-show rate all render; no prospect names anywhere |
| 6 | `/dashboard` for the test agent | Every tile renders, no errors |

### 2.11 Data integrity sweep

Run at the end, on staging:

```sql
-- Nothing should come back from any of these.

-- An appointment counted twice through both sources
select cl.id from public.call_logs cl
 join public.appointments ap on ap.source_call_log_id = cl.id
 group by cl.id having count(*) > 1;

-- A terminal appointment with no resolution day
select id from public.appointments where status <> 'scheduled' and resolved_on is null;

-- A pending appointment that has one
select id from public.appointments where status = 'scheduled' and resolved_on is not null;

-- appt_date out of step with the columns that derive it
select id from public.appointments
 where appt_date is distinct from coalesce(resolved_on, (scheduled_for at time zone 'America/New_York')::date, appt_date);

-- Metrics that never drained
select count(*) from private.metrics_dirty;
```

- [ ] All empty, and `metrics_dirty` is 0

---

## 3. If something is wrong

Both migrations revert as a function swap plus an index shape — the footers
spell it out. Neither deleted or rewrote a row, so a revert loses the
guards, not the data. Appointments created by the call form survive and
keep counting through `set_on`; reschedule pairs keep their links.

The app half reverts by redeploying the previous commit. Phase B's columns
stay populated and harmless either way.

If a **metric** looks wrong rather than a screen: do not hand-write an
`UPDATE`. Mark the agent-days dirty and let `drain_metrics` rebuild them
through `recompute_day`, per §6 of the plan and the runbook in
`11-incident-response.md`. A hand-written backfill is a second definition
of the metric, which is exactly how P23 and P24 went wrong.
