# Test plan

Priority order: **RLS tests > integration > unit > E2E.** A wrong pixel is an
annoyance; a wrong policy is a privacy incident.

## 1. RLS / database — pgTAP (`supabase test db`)
Use the Basejump test helpers to create users and switch roles inside a
transaction. Seed **two organizations**: `org_x` with `smd_x → assoc_1, assoc_2`
and `org_y` with `smd_y → assoc_3`. Also seed a third level under `assoc_1`
(`assoc_1 → assoc_1a`) even though v1 is two levels — it proves the closure
trigger before the hierarchy actually deepens.

For each of `call_logs`, `appointments`, `sales`, `recruiting_logs`:

| # | As | Action | Expect |
|---|---|---|---|
| 1 | assoc_1 | select own rows | all returned |
| 2 | assoc_1 | select assoc_2's rows | **0 rows** |
| 3 | assoc_1 | insert with `agent_id = assoc_2` | **rejected** |
| 4 | assoc_1 | update assoc_2's row | **0 rows affected** |
| 5 | smd_x | select assoc_1's rows directly | **0 rows** (aggregate-only rule) |
| 6 | smd_y | anything belonging to org_x | **0 rows** |
| 7 | anon | select anything | **0 rows** |

Hierarchy and RPC tests:
- `is_upline_of`: smd_x→assoc_1 true; smd_x→assoc_3 **false**; assoc_1→assoc_2
  false; self true
- `team_week_summary` as smd_x returns exactly {smd_x, assoc_1, assoc_1a, assoc_2}
- `team_week_summary` as assoc_1 returns {assoc_1, assoc_1a}
- `agent_daily_activity(assoc_3, ...)` called by smd_x returns **0 rows**
- `team_day_summary` never returns an agent from another org
- Cross-org write: setting `assoc_3.upline_id = smd_x` is **rejected** by the
  same-org trigger
- **Return-shape assertion**: no RPC's return columns include `contact_name`,
  `client_name`, `prospect_name`, or `notes`. Assert against
  `information_schema` so a future column addition fails the build.
- Closure trigger: insert agent → self-row `(id,id,0)` exists; move `assoc_1a`
  from `assoc_1` to `assoc_2` → `assoc_2` sees them, `assoc_1` does not,
  `smd_x` still does; setting a descendant as upline is rejected (cycle guard);
  moving an agent across orgs is rejected by the same-org trigger
- Deactivated agent is excluded from roster but their history still sums
- Targets: smd_x can write an org default and an override for assoc_1;
  assoc_1 **cannot** write any target; assoc_1 can read the default and their
  own override but not assoc_2's; smd_y cannot write into org_x; changing a
  target does not change a prior week's scored percentage
- `private.effective_target`: override beats org default beats fallback; the
  correct historical row is chosen for a past week
- `audit_log`: an authenticated user cannot insert, update, or delete
- **Privilege escalation**: assoc_1 attempting `update agents set role='admin'
  where id = self` is **rejected**; same for `upline_id`, `org_id`, `status`.
  assoc_1 updating own `full_name` succeeds. This is the single most important
  test in the file — RLS is row-level and will not stop a column change on a row
  you already own.
- `daily_metrics`: assoc_1 selects own rows; selects assoc_2's → 0 rows;
  any direct insert/update/delete by an authenticated user → rejected
- Targets uniqueness: two org-default rows for the same `effective_from` are
  rejected (partial unique index, not the NULL-distinct table constraint)

### `daily_metrics` correctness (the read model — treat as critical)
- Insert a call → dirty row appears → drain → `daily_metrics.calls_made = 1`
- Delete that call → drain → back to 0 (not stuck at 1)
- Edit a call's date across a day boundary → **both** old and new days recompute
- Drain the same dirty row twice → identical result (idempotence)
- Nightly reconcile over a deliberately corrupted `daily_metrics` row restores it
- `daily_metrics` never contains a row for an agent in another org
- Fuzz: 500 random insert/update/delete operations, then assert
  `daily_metrics` equals a from-scratch recompute over raw logs. This one test
  is worth more than the rest of the suite combined.

## 2. Unit — Vitest
- `lib/dates.ts`: Monday week start across DST and year boundaries; the
  workbook's "Week Of (Monday)" semantics must match exactly
- Streak: consecutive days meeting `min_calls_per_day`, broken by a gap,
  counted through today, unaffected by future-dated empty rows
- Funnel and ratio math (dial-to-connect, no-show rate, 4-week rolling average)
  — assert against the numbers the existing workbook produces for the same input
- Currency cents ↔ display
- Import parser: header mapping, blank-row skip, malformed date, and a file
  containing another agent's `agent_id` (must be ignored)
- Import idempotency: re-uploading the identical file imports zero rows;
  uploading the same file with one row appended imports exactly one row;
  **two genuinely identical calls to the same contact on the same day both
  import** (the `import_row_hash` must not collapse them)

**Golden-file test** — build in **P3**, at the data layer: import the real
`Deepak_Reddy_M_weekly_calls_tracker.xlsx`, drain the queue, and assert the
resulting `daily_metrics` rows plus the derived values from `lib/metrics.ts`
equal the workbook's Dashboard tab. In **P4** a second, thinner assertion checks
that the rendered dashboard displays those same numbers. Splitting it this way
means P3 can pass before any dashboard exists. Never delete either half.

## 3. Integration — Vitest + local Supabase
Server Actions against a real database: create call → daily counter increments →
roster RPC reflects it; invitation accept wires the correct upline; expired and
reused tokens rejected.

### Contacts and follow-ups
- `contacts` unique per agent on lower(full_name): logging "bharadwaj" then
  "Bharadwaj" reuses one contact, does not create two
- Two agents may each have a contact named "Bharadwaj"; neither sees the other's
- assoc_1 selects assoc_2's contacts → **0 rows**; smd_x selects any contacts → **0 rows**
- `/today` query returns only rows where `follow_up_on <= today` and
  `follow_up_done_at is null`, for the calling agent only
- Snooze moves the date; mark-done sets `follow_up_done_at` and removes it from the queue
- Deleting a contact cascades its calls, appointments, and sales

### Auth and account
- Expired invitation token rejected; reused token rejected; token for a
  deactivated org rejected
- Signup with no token creates nothing
- `handle_new_user` takes `upline_id`, `role`, and `org_id` from the invitation,
  never from client-supplied metadata — attempt it with forged metadata and
  assert the invitation wins
- Deactivated agent cannot sign in; their historical rows still sum into the
  team roster
- A leader without MFA is blocked from `/team`
- Password reset token is single-use and expires in 1 hour
- Nudge is rate-limited to one per agent per week and writes an audit row

## 4. E2E — Playwright
1. Leader invites → associate signs up → logs a call → **call the drain function
   directly, then** assert it appears on `/team`. Do not wait on the one-minute
   pg_cron cadence — that is a guaranteed flaky test. Expose the drain as an
   RPC the test can invoke.
2. Associate navigates to `/team` → redirected, not 500
3. Associate requests `/team/[otherAgentId]` directly → 404, no data leak in the
   payload
4. Import flow: upload the real workbook, preview, commit, dashboard matches
5. Mobile viewport: quick-log completes in five taps
6. Offline: log two calls with network off, reconnect, both persist exactly once
7. Full first-run: invitation email → accept → onboarding → first call logged,
   under 60 seconds of interaction
8. Follow-up loop: log a call with "call back Monday" → travel the clock to
   Monday → it appears on `/today` → tap through to a pre-filled log form
9. Back-date: log a call dated yesterday; it lands on yesterday's `daily_metrics`
   row and does not break today's streak calculation
10. Every empty state in `docs/09-account-and-auth.md` renders its named action —
    assert no screen shows a bare "No data"


## 5. Non-functional
- Seed **200 agents × 250 days × 10 calls (500k call rows)** and measure:
  roster p95 <300 ms, 8-week trend <300 ms, single-agent daily grid <150 ms
- Confirm the roster query plan touches `daily_metrics` only — if `call_logs`
  appears in the roster's `EXPLAIN`, the read model is being bypassed
- Dirty-queue drain keeps up: 2,500 writes/day is ~2/min; test a 10k-row burst
  (spreadsheet import) drains within 5 minutes without blocking writes
- `EXPLAIN ANALYZE` every RLS-filtered query; no sequential scan on
  `agent_closure`
- Lighthouse mobile: performance >=90, accessibility 100 on `/log`
- axe-core in CI on `/log`, `/dashboard`, `/team`

## CI gates
`typecheck → lint → vitest → supabase db lint → pgTAP → build → playwright`.
Any red blocks merge. Advisors run nightly against staging.
