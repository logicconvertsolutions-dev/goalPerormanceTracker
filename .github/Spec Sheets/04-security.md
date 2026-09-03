# Security

**Reflects the live state as of 2026-08-31.** The threat model and controls
below are the original P1 design, still accurate as *intent* — what changed
is that three real incidents matching this exact threat model were found and
fixed in a CSO-style audit pass (P9, commit `56d42e3`) plus a fourth,
adjacent one (commit `7bad83a`). Full precise detail on all four is in
"Incidents found and fixed" below; that section is the reason this file
needed a rewrite. A P11 note on item 1 below flags one further
compatibility fix (not an external finding) caught while making an admin's
`org_id` nullable.

Threat model, in order of realistic likelihood:
1. A misconfigured RLS policy exposes one agent's prospects to another agent.
2. Prospect PII sits in a third-party system with no consent record and no
   retention limit → PIPEDA problem, and a WFG compliance problem.
3. Service-role key leaks into the client bundle → total database compromise.
4. Invitation link is guessable/replayable → unauthorised account attached to a
   real hierarchy.
5. An ex-associate retains access after leaving the team.

**A fifth realistic vector, found in practice rather than predicted:** an
authorization check that verifies *who* the caller is but not *what org* the
target belongs to, on a `service_role`-backed admin RPC that bypasses RLS by
design. See incidents #1 and #2 below — this is now the primary thing to
re-check whenever a new admin or cross-agent RPC is added.

## Controls

### Database
- RLS enabled on **every** table in `public`, including every table added
  since P1 (`notification_prefs`, `mfa_recovery_codes`, `agent_nudges`,
  `notification_log`, `team_roster`, `agent_training_reminders`). CI fails on
  Supabase advisor lints `0008 rls_enabled_no_policy`,
  `0013 rls_disabled_in_public`, `0002 auth_users_exposed`,
  `0011 function_search_path_mutable`, `0010 security_definer_view`,
  `0024 permissive_rls_policy` — gated behind `SUPABASE_ACCESS_TOKEN` /
  `SUPABASE_PROJECT_REF` repo secrets in `.github/workflows/ci.yml`; the step
  currently skips itself if those secrets aren't set rather than failing, per
  that workflow's own inline comment. Confirm they're set before trusting
  this gate is live.
- All helper functions in `private` schema; `private` is **not** in the
  exposed schema list. Every `security definer` function declares
  `set search_path = ''` — true of every RPC added through P9, not just the
  original set. See `docs/02-data-model.md` for the full current list.
- Policies always `TO authenticated`; `anon` gets nothing in `public`.
- Wrap `auth.uid()` and helper calls as `(select fn())` so Postgres evaluates
  once per query rather than per row.
- Index every column referenced in a policy.
- `audit_log` now has **two** SELECT policies (was one): admin gets a global
  read, a leader gets an org-scoped read (`docs/02-data-model.md`) — both
  still no write policy; only definer functions insert.
- **Column-level protection on `public.agents`** — unchanged principle, one
  addition: the guard trigger now has a session-scoped bypass
  (`app.privileged_agent_write`) for the specific SECURITY DEFINER functions
  that need to write role/upline/org/status after already authorizing the
  change themselves (`deactivate_agent()`, `delete_my_account()`). Anywhere
  else a user can update a row they own, check the same class of bug.
- `daily_metrics` is RLS-protected (own rows, select only) — unchanged.

### Auth
- **Invite-only. Public signup disabled.** Unchanged; the invitation's `org_id`/
  `upline_id`/`role` are read server-side from the matched `invitations` row
  by the `handle_new_user` trigger and never trusted from client-supplied
  signup metadata — confirmed still true in the live `acceptInvitation`
  Server Action.
- Store `sha256(token)`, never the raw token. Unchanged. 7-day expiry,
  single use, revocable (`invitations.revoked_at`, new column — the original
  design didn't have an explicit revoke path; `/team/invites` now has one).
- Sessions via `@supabase/ssr`, httpOnly + Secure + SameSite=Lax cookies.
  Unchanged.
- **MFA is now mandatory for every role, not just leader/admin** (commit
  `50054c1`, since superseded in scope by the P9 fix below). The original
  design had MFA optional for associates; the live app requires it for
  everyone via `requireVerifiedAgent()`, applied to every page under
  `(app)/` except the MFA setup/verify pages themselves. Associates now hit
  the same `/mfa/setup` flow as leaders on first login.
- Supabase Auth rate limits — unchanged, defaults on.
- Offboarding: `status='inactive'` — unchanged behavior; `deactivate_agent()`
  now correctly interacts with the column-guard trigger (see above).

### Application
- Zod schema on every Server Action input — unchanged.
- Never instantiate the service-role client outside `lib/supabase/admin.ts` —
  unchanged, confirmed still the only import site of the service-role key.
- CI grep gate — unchanged, live in `.github/workflows/ci.yml` as the first
  step of the `ci` job, and it's a real *blocking* gate (not
  `continue-on-error`), unlike several other steps in that workflow — see
  `docs/05-testing.md` for the current, more precise picture of what in CI
  actually blocks a merge versus reports.
- Security headers via `next.config.js` — unchanged, confirmed live (CSP,
  HSTS, nosniff, referrer-policy, frame-deny).
- Rate limit `/api/import` and the log mutation path — implemented, but not
  as an HTTP-route limiter: there is no literal `/api/import` endpoint, import
  and logging are Server Actions, rate-limited via a new general-purpose
  `check_rate_limit()` RPC (`private.rate_limits`, P6e) keyed on
  `auth.uid()`. Import specifically is capped at 5/hour.
- Import path: validated MIME + size cap, parsed server-side, no formula
  evaluation, plus a 20,000-row cap added post-P12 (an oversized workbook
  fails fast with a specific message instead of risking the execution-time
  limit). Confirmed unchanged in spirit; see `docs/08-screen-specs.md`
  for how much the import UI itself has grown (preview/commit flow, per-sheet
  validation, name-based dedup with phone as a secondary signal — reversed
  from phone-based, see "Privacy" below).
- Dependabot + `npm audit` in CI — `npm audit --audit-level=high` is present
  but `continue-on-error: true` (reports, doesn't block); commit `7bad83a`
  addressed real CVEs this surfaced (xlsx parser, Next.js) directly rather
  than waiting on the gate. Pin the Supabase client version — unchanged.

### Privacy (PIPEDA — Ontario)
- Purpose limitation, data minimisation as principles — unchanged, but the
  concrete claim changed: **`contacts.phone` was added in P9**, reversing the
  original "no phone or email column" decision, then **made optional again
  post-P12** on an explicit compliance decision — collecting it is no
  longer required anywhere a contact is created (manual add, log/appointment
  /sale forms, device-contact import, Excel import), and name is the
  primary de-dup key everywhere, phone only a secondary signal. This is
  a partial return toward the original data-minimisation intent (an agent
  who never enters a phone number never has one stored for that contact),
  but the column itself and the ability to store phone when an agent
  chooses to enter one are both unchanged, so the privacy notice's "full
  names are stored" framing should still explicitly say phone numbers may
  be stored too, just not that doing so is required — confirm the
  in-product privacy notice reflects "optional" rather than either the
  original "not collected" or the P9 "collected" framing; this doc can't
  verify that from code alone.
- Retention: **auto-purge is implemented, not just planned.** A nightly
  pg_cron job (`private.purge_old_call_logs()`, P6) deletes `call_logs` older
  than `organizations.call_log_retention_months` (default 24, nullable to
  disable) unless linked to a sale. Configurable per org.
- Access + deletion: **both implemented.** `GET /settings/export` returns a
  JSON bundle of every table scoped to the caller. `delete_my_account()`
  hard-deletes contacts (cascading calls/appointments), scrubs sales/
  recruiting notes, anonymizes the agent row, and sets `status='inactive'` —
  distinct from the separate, admin-only, fully irreversible
  `admin_hard_delete_agent()` (see `docs/02-data-model.md`).
- Privacy notice at signup — the accept-invitation form now has an explicit
  required checkbox ("I accept the privacy notice. My SMD sees my numbers,
  never my contacts.") gating account creation; onboarding step 2 reinforces
  it visually (numbers shown, contact names/notes shown struck through).
- Breach-response procedure — **written, current.** See
  `docs/incident-response.md` (renamed from the placeholder reference in the
  original text; it now exists as `docs/11-incident-response.md` and is kept
  up to date independently of this file).

## Incidents found and fixed (P9 security pass, 2026-08-27)

Four issues, found in a CSO-style audit rather than predicted in advance —
worth reading in full because they're the concrete shape the threat model
above actually took in this codebase. All four are fixed and shipped.

### 1. Cross-tenant IDOR in admin agent-lifecycle RPCs
`admin_move_agent`, `admin_reactivate_agent`, `admin_hard_delete_agent`
(all `service_role`-only, bypassing RLS by design) and `admin_set_agent_role`
authorized purely on "is the caller an admin of *some* org" — none of them
verified the **target** agent belonged to the **actor's own** organization.
Any admin could act on any agent in either org: reassign upline, reactivate,
escalate role, or permanently hard-delete, across the tenant boundary this
entire product exists to enforce. **Fix:** each function now looks up both
the actor's and the target's `org_id` and raises a non-distinguishing
`'agent not found'` on mismatch (never a "wrong org" message — that would
confirm the target exists elsewhere). Migration: `p9d`.

**P11 note:** "the actor's own organization" above is historical — as of
`p11c` an admin has no `org_id` at all (see `docs/02-data-model.md`), so
this specific check no longer applies to the actor. The four functions'
target-lookup pattern (`select org_id ... if v_org is null then raise
'agent not found'`) had to be re-keyed off row existence rather than
`org_id` presence in the same migration, since a real admin *target* row
now legitimately has a null `org_id` — see `p11c`'s notes in
`docs/02-data-model.md`. Not a reopened vulnerability, just a compatibility
fix caught before it shipped.

### 2. In-org roster scope leak
`team_roster_update`/`team_roster_delete` RLS policies, and
`send_roster_training_reminder()`, checked role + org but — unlike their
sibling insert policy — never checked `is_upline_of(upline_id)`. Any
leader/admin in an org could edit, delete, or send a training reminder
against *any* leader's roster entries in that org, not just their own
downline's. **Fix:** added the missing `is_upline_of` check to both policies
and the RPC. Migration: `p9e`.

### 3. TOCTOU race in the 7-day nudge/reminder cooldown
`nudge_agent()` and `send_training_reminder()` rate-limited with a
non-atomic `SELECT EXISTS` check followed by a separate `INSERT`. Two
concurrent calls (e.g. a double-click, or overlapping cron runs for the
roster variant) could both pass the check before either write committed,
sending two notifications inside one supposed cooldown window. **Fix:**
`agent_nudges`/`agent_training_reminders` restructured from append-only logs
into single-row-per-agent trackers, rate-limited via
`INSERT ... ON CONFLICT (agent_id) DO UPDATE ... WHERE last_sent_at <= now() - interval '7 days'`
— the `WHERE` clause on the conflict update is the atomic check, evaluated
by the same statement as the write. Migration: `p9f`.

### 4. Admin MFA bypass (application layer, not RLS) — commit `7bad83a`
`requireAdmin()` checked `role === 'admin'` but never checked
`session.mfaVerified` — unlike its sibling `requireLeader()`, which already
chained through the MFA-checking `requireVerifiedAgent()`. A password-only
(aal1) admin session could reach the entire admin surface: cross-org
provisioning, role escalation, agent moves, hard-delete, the global audit
log. The identical gap existed independently in two hand-rolled Server
Action guards that call the service-role client directly and can't use the
redirect-based `requireAdmin()` — `requireAdminActor()` in
`admin/agents/actions.ts` and the inline check in `admin/orgs/actions.ts`'s
`provisionOrgAction`. Both checked role but not MFA. **Fix:** all three now
require `session.mfaVerified` explicitly — `requireAdmin()` calls
`requireVerifiedAgent()` instead of `requireAgent()`; the two Server Action
guards each gained an explicit `if (!session.mfaVerified) return { error: ... }`.
Shipped in the same commit as unrelated dependency-CVE fixes (xlsx parser
swapped to a patched SheetJS build; Next.js 14.2.35 → 15.5.24 for
WebSocket SSRF / Server Actions DoS / RSC deserialization advisories — see
`docs/02-data-model.md`'s note on the Next.js version and
`CLAUDE.md`'s stack line).

**Also fixed in the same pass, smaller:** recovery-code minting
(`generateRecoveryCodes()`) previously didn't require an already-verified
TOTP factor to exist, and didn't invalidate a prior code batch before
issuing a new one — both closed; a stored-XSS vector in notification email
templates (unescaped `fullName`/roster-name/`sentByName` interpolated
directly into HTML) — closed by escaping.

## Pre-launch gate

No production data until: pgTAP suite green · advisors clean · service-key
grep clean · MFA enforced for **every role** (tightened from "leaders" in the
original text — see the MFA-mandatory change above) · privacy notice live ·
backups verified with one restore drill. **Status of this gate as a whole is
Deepak's call to confirm** — this file can verify the technical controls
exist in code, not whether the restore drill has actually been run. See
`docs/00-open-questions.md` for the business questions (pilot agreement,
compliance sign-off) that sit alongside this gate and are still open.
