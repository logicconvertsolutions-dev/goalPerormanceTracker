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
