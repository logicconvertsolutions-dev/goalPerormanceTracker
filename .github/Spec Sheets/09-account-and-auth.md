# Account, auth, and the app shell

**Reflects the live app as of 2026-08-27.** Structure and copy match the
original design closely; the significant changes are (1) MFA is now
mandatory for every role, not just leader/admin, and (2) a real MFA bypass
existed and was fixed — see `docs/04-security.md` for the precise
vulnerability and fix, summarized here where it affects the screens.

---

## Who creates what — unchanged

No public signup. Same three paths as originally specified: admin
provisions an org (`/admin/orgs`), an SMD invites via `/team/invites`, a
stranger hitting an unauthenticated route gets no form, only an explanation.

---

## Screens

### `/login`
Matches spec closely. Email + password (default) or "Email me a sign-in
link" (magic link), toggled client-side with no page navigation.
- Wrong password / unknown email: "Email or password doesn't match." —
  confirmed identical wording for both cases, still never confirms which.
- Deactivated account: "This account is no longer active. Contact your
  SMD." — via a `?reason=deactivated` banner, checked client-side against
  `agents.status` right after a successful `signInWithPassword`, which then
  force-signs-out and redirects back with the banner.
- Rate limited: "Too many attempts. Try again in 15 minutes, or use a
  sign-in link." — triggered on an HTTP 429 from Supabase Auth.
- **MFA is not handled on this screen at all** — a successful sign-in
  navigates straight to `/today`; it's the downstream `requireVerifiedAgent()`
  guard (see "Route guards" below) that redirects an unverified session to
  `/mfa/verify` or `/mfa/setup`. Worth knowing if debugging a login issue:
  the failure surfaces one hop later than the login form itself.

### `/invite/[token]` — accept invitation
Matches spec. Server-rendered lookup by `sha256(token)` (never the raw
token), four states: **invalid** (no match) · **accepted** (→ `/login`) ·
**expired** (`revoked_at` set or past `expires_at`, shows the date) ·
**valid** (renders the form). Confirms who invited them and into which team
before asking for anything, per spec.
- Form: full name + password (min 8 chars) + a **required** checkbox — "I
  accept the privacy notice. My SMD sees my numbers, never my contacts." —
  gating submission, matching the original spec's "accepts the privacy
  notice" step.
- `org_id`/`upline_id`/`role` are read server-side from the matched
  `invitations` row by the `handle_new_user` DB trigger — never from
  client-supplied signup metadata, confirmed still true.
- On success: signs in with the just-set password, routes to `/onboarding`.

### `/onboarding` — first run, 3 steps, skippable
Matches spec's structure and content closely (goals read-only · what your
SMD can see, with contact names/notes shown struck through · bring your
spreadsheet or start fresh). One difference from the original design: **no
server-side gate enforces visiting onboarding** — Skip and both step-3
buttons just navigate to `/log` (or `/import`) directly. It's a first-run
nicety, not a required step a guard can force someone back into.

### `/forgot-password` → `/reset-password/[token]`
Matches spec. Always the same "If that email has an account, we've sent a
link" copy regardless of whether the address exists — explicit anti-
enumeration comment in the code. Token handling is entirely Supabase's
recovery-link flow (1-hour, single-use recovery session established before
the reset-password page ever loads); the page itself just collects a new
password. Expired/reused: "This reset link has expired or already been
used. Request a new one."

### `/mfa/setup` and `/mfa/verify`
**MFA is now required for every role on first login, not just leader/admin**
— the single biggest structural change to this section since the original
spec (commit `50054c1`, later hardened by the `7bad83a` fix described in
`docs/04-security.md`).

`/mfa/setup`: three-step flow — enroll (TOTP QR + manual key) → verify
(6-digit code) → **eight recovery codes shown once**, with a download
button. Matches spec. `?required=login`/`?required=team` shows a "Required
before you can continue" banner. Recovery-code minting now requires an
already-verified TOTP factor to exist (a gap closed in the same P9 security
pass, alongside the MFA-bypass fix) and always invalidates the previous
batch before issuing a new one.

`/mfa/verify`: single code-entry form against the account's existing
verified TOTP factor; routes to `?next=` (validated to start with `/`,
default `/today`) on success.

Both pages guard with the base `requireAgent()`, not the MFA-checking
`requireVerifiedAgent()` — deliberately, to avoid a self-redirect loop.

### `/profile`
Matches spec closely.
- Full name (editable — RLS column grants restrict `authenticated` UPDATE on
  `agents` to `full_name` only, so this is safe at the DB level, not just in
  the UI), email (read-only, no self-service change flow currently — the
  original spec's "change requires confirming both addresses" is not
  implemented), role (read-only), joined date.
- MFA status: Enabled/Not enabled badge, with a context-appropriate action —
  Set up (not enrolled), Reset (enrolled + this session verified, behind a
  confirm dialog and a live `aal2` re-check), or "Verify to manage"
  (enrolled but this session hasn't stepped up).
- Password change: requires current password, re-authenticates via
  `signInWithPassword` before allowing the update — matches spec.
- **Sessions**: implemented as "Sign out everywhere" (global
  `supabase.auth.signOut({ scope: 'global' })`) — matches the spec's intent,
  but there is **no list of individual active sessions with device/last-seen**
  as the original spec described; it's a single blunt action, not a
  per-session view.

### `/settings`
Matches spec closely, in the same card order.
- **Goals** — read-only, "set by your SMD," from `my_target`.
- **Notifications** — three independent toggles (evening nudge, Sunday
  summary, Monday team digest — the last one described in-UI as "Leaders
  only"), matching spec.
- **Time zone** — a curated list of Canadian IANA zones, defaults to
  browser-detected. **Week start is a hardcoded "Monday" label, not an
  editable setting** — matches the original spec's "shown as a fact not a
  setting" description exactly.
- **Import** — link to `/import`.
- **Your data** — "Download everything" (`GET /settings/export`, a single
  JSON bundle of every own-scoped table) and "Delete my account" (destructive
  confirm requiring the literal text `DELETE` to be typed before the button
  enables). Matches spec's intent; the export is JSON only, not JSON+CSV as
  the original spec listed.

Account deletion (`delete_my_account()` RPC) — see `docs/02-data-model.md`
and `docs/04-security.md` for exactly what's retained vs. erased; the
Server Action also explicitly signs the session out afterward, since the
RPC alone doesn't invalidate the cookie.

### `/logout`
Matches spec, plus one implementation detail: the page itself
(`/logout`, visiting it signs out immediately, no confirmation) and a
separate `signOutAction` Server Action do the identical thing — the
`AccountMenu`'s "Sign out" item calls the action directly rather than
navigating to the page.

### SMD-side account screens
- **`/team/invites`** — matches spec: bulk paste (comma/newline-separated
  emails), pending list with sent/expiry dates, an "Expired" badge, per-row
  **Resend**/**Revoke**. Successfully-sent invites also show a copyable link
  inline as an email-delivery fallback.
- **`/team/members`** — matches spec's "active roster with Deactivate," plus
  a second, earlier-stage section not in the original design: a **team
  roster** (name/email/phone, no login) an SMD can populate *before* sending
  any invitation, with a "Send reminder" training-nudge action and an
  "Invite" action that promotes a roster row into a real invitation. A
  roster entry disappears automatically once its email matches a joined
  agent. Deactivate confirms with the same "access revoked, history
  retained, disappears from the roster" copy the spec called for. As of the
  P9 security pass, roster update/delete/reminder actions are correctly
  scoped to the caller's own downline (see `docs/04-security.md` — this was
  one of the fixed gaps).
- **`/team/audit`** — matches spec: goal changes, invitations, deactivations,
  who/what/when, org-scoped via a dedicated RLS policy (added since the
  original design — the audit table originally had only one, admin-global,
  SELECT policy).

### Admin screens — grown well past the original one-line sketch
The original spec covered these in a single line each; they're now full
screens:
- **`/admin/orgs`** — "New organization" form (name, SMD name, SMD email) →
  provisions the org and sends the SMD invite; a flat "Existing" list of org
  names (no per-org detail/edit here yet).
- **`/admin/agents`** — cross-org (not downline-scoped) agent management,
  grouped by organization. Per agent: inline **role** select, inline
  **upline** select (move between uplines within the same org), conditional
  **Reactivate**, and **Hard-delete** behind a dialog requiring the admin to
  type the agent's exact full name — explicitly distinguished in the dialog
  copy from deactivation ("permanently erases... not the same as
  deactivation"). All four mutating actions bypass RLS via the service-role
  client, gated entirely by the application-level `requireAdminActor()`
  check — see `docs/04-security.md` for why the MFA gap here mattered, and
  for the P9d cross-org fix on the underlying RPCs.
- **`/admin/audit`** — same table component as `/team/audit`, unscoped
  ("everything, every organization"), capped at 500 rows vs. `/team/audit`'s
  200.
- **`/admin/pilot`** (new, not in the original spec at all) — a purpose-built
  dashboard for the P7 pilot-readiness question, not a stub: pulls a 10-
  business-day active-logger window per org, flags an org "at risk" (red)
  if fewer than two-thirds of active agents are hitting 8-of-10 days, with
  a per-agent per-day dot grid. Read-only. See `docs/06-build-phases.md`'s
  P7 entry — this page is that phase's stated instrument.

---

## Notifications — matches spec closely

The three notifications, cadence, and content match the original design
exactly: evening nudge (weekdays 7 PM local, only if nothing logged that
day), Sunday summary (6 PM local, unconditional), Monday SMD digest (8 AM
local, leaders/admins only, unconditional). Role eligibility is enforced
structurally (`roleAllows()` — an associate is never eligible for the digest
and vice versa), which is also what guarantees "never more than one per
person per day" without needing separate logic for it.

**Mechanism, not in the original spec's level of detail:**
- Timezone resolution is per-instant via `Intl.DateTimeFormat` (handles DST
  automatically), defaulting to `America/New_York` if an agent has no time
  zone set.
- Cron cadence is **every 15 minutes via GitHub Actions**, not Vercel Cron
  — see `docs/02-data-model.md` and `docs/06-build-phases.md`'s "manual
  steps" note for why (Vercel Hobby only allows daily schedules; a 15-minute
  cadence is needed to catch every agent's local send window). This is
  scoped to notifications only — the `daily_metrics` pipeline's own cron
  jobs are unaffected and still run as pg_cron inside Postgres.
- Idempotency is an insert-first unique constraint
  (`notification_log (agent_id, kind, local_date)`), not application-level
  locking — losing the race just skips that send rather than double-sending.
- **Delivery is a direct HTTP call to Resend's API**, no SDK dependency;
  no-ops with a console warning if credentials aren't configured, so a
  preview/dev environment without `RESEND_API_KEY` doesn't crash the cron
  route.
- The one-click unsubscribe link (`/unsubscribe`) is genuinely session-free,
  per spec's "actually works" requirement — authorized by an HMAC-SHA256
  signature over `(agentId, kind)` verified in constant time, not a
  database-stored token. Always links back to `/settings`.
- A stored-XSS vector in the email templates (unescaped agent/roster names
  interpolated into HTML) was found and fixed in the P9 security pass — see
  `docs/04-security.md`.

---

## The app shell — matches spec, with current nav labels

**Mobile** — bottom tab bar: **My Day · Activity Logs · Contacts · My
Dashboard**, plus **My Team** for leaders/admins. The centre-weighted **Log**
tab described in the original spec is now a "Log Activity" action that opens
a shared dialog rather than navigating to a page — same job (fastest path to
logging), different mechanism. Avatar top-right opens the account menu
(profile/settings/admin links if applicable/sign out).

**Desktop** — left rail with the same primary items plus a secondary group
(Log Activity, Meeting Notes, Clients) that doesn't fit the mobile tab bar's
five slots; those three surface on mobile via the account menu instead.

**Route guards** — implemented as a layered chain in `src/lib/auth/guards.ts`,
more structured than the original spec's two-guard description:

```
requireAgent()          → any signed-in, active agent
requireVerifiedAgent()  → requireAgent() + must be MFA-verified this session
requireLeader()         → requireVerifiedAgent() + role in {leader, admin}
requireAdmin()          → requireVerifiedAgent() + role === admin
```

An associate hitting `/team` is redirected (via `requireLeader()`), matching
spec's "not shown a 403" requirement. The 403-vs-404 distinction for
cross-org access described in the original spec is enforced at the RLS/RPC
layer (agent lookups return not-found rather than forbidden — see
`docs/02-data-model.md`'s admin RPC fixes for the same non-distinguishing-
error principle applied there).

---

## First-run empty states — matches spec

Every empty state named in the original spec's table is confirmed present
in the live code with matching or near-matching copy, per the screen-by-
screen detail in `docs/08-screen-specs.md`. No changes worth calling out
here beyond what that file already covers.
