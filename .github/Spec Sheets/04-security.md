# Security

Threat model, in order of realistic likelihood:
1. A misconfigured RLS policy exposes one agent's prospects to another agent.
2. Prospect PII sits in a third-party system with no consent record and no
   retention limit → PIPEDA problem, and a WFG compliance problem.
3. Service-role key leaks into the client bundle → total database compromise.
4. Invitation link is guessable/replayable → unauthorised account attached to a
   real hierarchy.
5. An ex-associate retains access after leaving the team.

## Controls

### Database
- RLS enabled on **every** table in `public`. CI fails on Supabase advisor lints
  `0008 rls_enabled_no_policy`, `0013 rls_disabled_in_public`,
  `0002 auth_users_exposed`, `0011 function_search_path_mutable`,
  `0010 security_definer_view`, `0024 permissive_rls_policy`.
- All helper functions in `private` schema; `private` is **not** in the exposed
  schema list. Every `security definer` function declares `set search_path = ''`.
- Policies always `TO authenticated`; `anon` gets nothing in `public`.
- Wrap `auth.uid()` and helper calls as `(select fn())` so Postgres evaluates
  once per query rather than per row.
- Index every column referenced in a policy (`agent_id`, `agent_closure`
  both directions).
- `audit_log` has a SELECT policy for admin and **no** write policy; only
  definer functions insert. Nothing can update or delete it.
- **Column-level protection on `public.agents`.** RLS grants access to a *row*,
  not to specific columns — a self-update policy therefore permits an associate
  to set their own `role = 'admin'`. Revoke table-wide UPDATE, grant
  `UPDATE (full_name)` only, and add the guard trigger in `docs/02-data-model.md`.
  Anywhere else a user can update a row they own, check the same class of bug.
- `daily_metrics` is RLS-protected (own rows, select only) even though uplines
  reach it via RPC — a table with no policy is one advisor lint away from a leak.

### Auth
- **Invite-only. Public signup disabled.** Signup requires a valid, unexpired,
  unaccepted invitation.
- Store `sha256(token)`, never the raw token. Compare in constant time. 7-day
  expiry, single use, revocable.
- `handle_new_user` trigger: validate invitation → create `agents` row with
  `upline_id` and `role` **from the invitation, never from client input** →
  mark accepted → write audit row. Reject if no invitation.
- Sessions via `@supabase/ssr`, httpOnly + Secure + SameSite=Lax cookies. Token
  refresh in middleware. No JWT in localStorage.
- MFA (TOTP) required for `leader` and `admin`; optional for associates.
- Supabase Auth rate limits on sign-in and OTP; leave defaults on, tighten
  password sign-in attempts.
- Offboarding: `status='inactive'` revokes app access and hides the agent from
  rosters, while history is retained for the upline's aggregates.

### Application
- Zod schema on every Server Action input. Never trust `agent_id` from the
  client — always derive from the session.
- Never instantiate the service-role client outside `lib/supabase/admin.ts`;
  that file imports `server-only`.
- CI grep gate: fail the build if any `NEXT_PUBLIC_*` value matches a
  service-key pattern, or if `SUPABASE_SERVICE_ROLE_KEY` appears in a file under
  `app/**` marked `'use client'`.
- Security headers via `next.config.js`: CSP (no `unsafe-eval`), HSTS,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `X-Frame-Options: DENY`.
- Rate limit `/api/import` and the log mutation path (Upstash or Supabase edge).
- Import path: validate MIME + size cap; parse in a worker; never `eval`
  spreadsheet formulas; strip external links.
- Dependabot + `npm audit` in CI. Pin the Supabase client version.

### Privacy (PIPEDA — Ontario)
- Purpose limitation: prospect data exists to track the agent's own activity.
  Nothing is sold, shared, or used for training.
- Data minimisation: `contact_name` is `not null` in v1. A future revision may
  relax it and add an "initials only" org setting; until then, say plainly in
  the privacy notice that full names are stored.
- Retention: auto-purge `call_logs` rows older than 24 months unless linked to a
  sale. Configurable; default on.
- Access + deletion: agent can export all own data as JSON/CSV and can delete
  their account, which hard-deletes PII and retains only anonymised daily counts
  for the upline's historical aggregates.
- Privacy notice at signup explaining exactly what the upline can and cannot see.
  This is also the adoption argument — say it in the product, not just the policy.
- Breach-response procedure written as `docs/incident-response.md` in **P6**
  (who is notified, within what window, what gets logged). It does not exist yet;
  do not cite it as though it does.

## Pre-launch gate
No production data until: pgTAP suite green · advisors clean · service-key grep
clean · MFA enforced for leaders · privacy notice live · backups verified with
one restore drill.
