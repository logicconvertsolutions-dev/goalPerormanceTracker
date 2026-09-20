# Incident response

Written per `04-security.md`'s P6 requirement: "Breach-response procedure...
who is notified, within what window, what gets logged." Covers a security
incident affecting this product — a leaked credential, an RLS bypass, an
unauthorized data access, or anything that could expose prospect PII or
cross-org data.

## Severity

| Level | Definition | Example |
|---|---|---|
| **Critical** | Confirmed unauthorized access to prospect PII, or cross-org data exposure | An RLS policy gap let one org read another org's contacts |
| **High** | Credential or key compromise, no confirmed data access yet | Service-role key committed to a public repo |
| **Medium** | A vulnerability found before exploitation | An advisor lint catches a `security definer` function missing `search_path` |
| **Low** | Availability or minor bug, no data exposure | Rate limiter misfires, degraded but not exposing anything |

## Response window

1. **0–1 hour: contain.** Rotate the exposed credential (Supabase service-role
   key, database password) immediately via the Supabase dashboard. If the
   exposure is a specific RLS policy, disable the affected table's public
   access (`revoke all ... from authenticated, anon`) until a fix ships —
   a temporarily broken screen beats a temporarily open database.
2. **Within 4 hours: assess.** Determine scope — which tables, which orgs,
   how many agents/contacts, what window of time. Query `audit_log` for the
   affected period; if the incident predates good audit coverage, note that
   gap explicitly rather than guessing.
3. **Within 24 hours: notify.**
   - Every affected org's SMD, by email, in plain language: what happened,
     what data was potentially exposed, what we've done about it.
   - If prospect PII was actually exposed (not just at risk) to a party who
     shouldn't have seen it, this is a PIPEDA breach and Ontario's
     [Information and Privacy Commissioner](https://www.ipc.on.ca/) may need
     notifying — get counsel involved before that decision, not after.
4. **Within 72 hours: fix and verify.** Ship the actual fix (migration,
   policy correction, key rotation completed), re-run the full pgTAP suite
   and the Supabase advisors, and confirm the specific exploit path is closed.
5. **Within 1 week: retro.** A short written summary — root cause, what
   caught it (or didn't), what changes prevent the same class of bug. Add a
   pgTAP test that would have caught it, if one doesn't already exist.

## What gets logged

- The incident itself: timeline, who was notified and when, in a private
  document (not `audit_log` — that table is for product actions, not
  incident narrative).
- Every remediation action as a normal `audit_log` row where it fits the
  existing shape (a key rotation isn't a product action and won't have one;
  a policy fix ships as a migration, which is its own record in git).

## Who's notified, and by whom

Today (two orgs, one operator): Deepak handles all four steps personally —
contain, assess, notify, fix. There is no on-call rotation yet; this section
gets a rewrite the moment a second person carries any part of this. Until
then, treat this document as a checklist for one person under pressure, not
an org chart.

## Before this procedure is trustworthy

Per `04-security.md`'s pre-launch gate: pgTAP suite green, advisors clean,
service-key grep clean, MFA enforced for leaders, privacy notice live, and
one restore drill actually run against a real backup — not simulated. None
of that is a substitute for this document; all of it has to be true before
this document is more than aspirational.

## Runbook — a metric backfill went wrong

Added with P25 Phase A. Applies to any change that redefines a `daily_metrics`
column or rebuilds the read model.

**Symptom:** dashboard numbers moved in a direction nobody predicted, or an
agent reports a period that "used to say something else."

1. **Do not hand-edit `daily_metrics`.** It is derived. Every fix goes through
   `private.recompute_day`, or the next rebuild silently reverts it.
2. **Establish what changed.** Diff the snapshots taken either side of the
   migration (`scripts/metrics-snapshot.sql`; §6 of
   `12-appointment-lifecycle-remediation.md` requires one before promotion).
   No before-snapshot means no baseline — take one now so the *next* step is
   measurable, and say so in the incident note.
3. **Check whether the rebuild simply hasn't finished.** A backfill marks
   agent-days dirty and lets the cron drain them at 1000/minute, so numbers
   are legitimately mid-flight for a while:
   ```sql
   select count(*) from private.metrics_dirty;   -- 0 = rebuild complete
   select public.drain_metrics(10000);           -- finish it now; repeat until 0
   ```
4. **Rebuild a specific window** once the function body is correct:
   ```sql
   insert into private.metrics_dirty (agent_id, activity_date)
   select id, d::date from public.agents
   cross join generate_series('<from>'::date, '<to>'::date, interval '1 day') d
   on conflict do nothing;
   ```
5. **If the function body itself is wrong**, revert it — migrations carry the
   previous definition verbatim in their header for exactly this — then
   re-mark the affected window and drain. Reverting the function alone does
   nothing until the rows are recomputed.
6. **Know what cannot be rebuilt.** `daily_metrics` is derived from raw rows,
   so any day whose source rows were purged by
   `private.purge_old_call_logs()` cannot be reconstructed. Run
   `scripts/metrics-damage-report.sql` to size that loss and **name it** in
   the incident note and any agent-facing announcement rather than leaving
   the days as silent zeroes.
7. **Announce a restatement.** If published numbers changed, say so via
   `announcements` — what moved, which direction, and that the new values are
   the correct ones. An unannounced restatement reads as a bug and costs more
   trust than the original defect.
