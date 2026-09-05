# Account, auth, and the app shell

**Reflects the live app as of 2026-08-31.** Structure and copy match the
original design closely; the significant changes are (1) MFA is now
mandatory for every role, not just leader/admin, (2) a real MFA bypass
existed and was fixed — see `docs/04-security.md` for the precise
vulnerability and fix, summarized here where it affects the screens — and
(3) **P11: admin is no longer an organization member at all** — see
"Admin is not part of any organization" below, the single biggest
structural change to this section since P2's original shell design.

---

## Who creates what — unchanged in spirit, admin's own path changed

No public signup. Same three paths as originally specified: admin
provisions an org (`/admin/orgs`), an SMD invites via `/team/invites`, a
stranger hitting an unauthenticated route gets no form, only an explanation.

An existing admin can also invite a *new* admin (`create_invitation`'s
`p_role = 'admin'` path, restricted to an admin caller) — this has always
been possible at the database layer but there has never been a UI form for
it; the account this produces goes through the same no-org handling
described below regardless.

---

## Admin is not part of any organization (P11, new)

Every admin account — including one promoted from associate/leader, or one
created via the admin-invites-admin path above — now has `agents.org_id`
and `agents.upline_id` both `null`. This used to not be true: an admin kept
whatever org/upline they came from, which put them in that org's hierarchy
in ways that never made sense for a platform-level role — visible in their
former upline's "My Team" downline roster, counted in `agent_closure`, and
subject to the same-org upline fence. Admin's cross-org reads were always
role-gated, not org-scoped (`agents_admin_read`/`organizations_admin_read`),
so nothing about admin's actual capabilities depended on having an org —
this was purely a leftover from every agent originally being an org member.

**What actually changed:**
- `agents.org_id` is nullable now, but only for `role = 'admin'` — a DB
  check constraint (`agents_org_required_unless_admin`) still requires one
  for every associate/leader. A second constraint
  (`agents_admin_no_upline`) blocks a null-org agent from having an
  `upline_id` at all.
- **Promoting** an agent to admin (`/admin/agents`' role select,
  `admin_set_agent_role`) nulls their `org_id`/`upline_id`, and reassigns
  any of *their own* direct reports to top-level (`upline_id = null`) in
  the same org — a promoted agent can't stay someone's phantom upline.
- **Demoting** an agent away from admin requires picking an org for them to
  rejoin — that information was deliberately discarded on promotion, so the
  role `<Select>` on `/admin/agents` (and the per-agent detail page) opens
  a small dialog asking which organization when the new role isn't admin.
- Existing admins (from before this migration) were backfilled the same
  way: `org_id`/`upline_id` nulled, their own direct reports (if any)
  surfaced to top-level.
- `feedback` is the one org-scoped table an admin can still legitimately
  write to (submitted from the account menu, every role) — its `org_id` is
  nullable too, set to `null` for an admin-submitted report rather than
  raising.
- `requireLeader()` (`src/lib/auth/guards.ts`) no longer admits admin — it
  used to allow `role in ('leader', 'admin')`, now only `'leader'`. Every
  `/team/*` screen is SMD-only; admin's equivalent tools live entirely
  under `/admin/*` (see "Admin screens" below).

**Nav consequence:** admin's tab bar / rail nav is a completely separate
set of items (Orgs · Agents · Audit · Pilot · Feedback) that *replaces*
My Day / Activity Logs / Contacts / My Dashboard / My Team, not one that's
appended to it the way it used to be — see "The app shell" below. Signing
in as admin (password or magic link), completing MFA enrollment/step-up, or
accepting the one-time terms gate all land on `/admin/agents` now, not
`/today` — an admin has no personal "My Day."

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
  accept the Terms & Conditions and privacy notice. My SMD sees my numbers,
  never my contacts." — gating submission, matching the original spec's
  "accepts the privacy notice" step. **P10:** the checkbox is now also
  enforced server-side (`acceptInvitation()` rejects the call with
  `z.literal(true)` if it's missing, not just a disabled submit button) and
  actually recorded — `agents.terms_accepted_at` is stamped at account
  creation, which previously didn't exist at all.
- `org_id`/`upline_id`/`role` are read server-side from the matched
  `invitations` row by the `handle_new_user` DB trigger — never from
  client-supplied signup metadata, confirmed still true. **P11:** for an
  admin-role invitation specifically, both are forced to `null` regardless
  of what the inviting admin's own row carried — see "Admin is not part of
  any organization" above.
- On success: signs in with the just-set password, routes to `/onboarding`.

### `/confirm-email-change/[token]` (P11, new)
The agent-facing half of an admin-initiated email change (see
`/admin/agents/[agentId]` above) — no login required, same reasoning as
`/invite/[token]`: the agent may not even be signed in when they click the
link. Server-rendered lookup by `sha256(token)` against `agent_email_changes`,
four states: **invalid** (no match) · **confirmed** (already used, →
`/login`) · **expired** (past `expires_at`, 7 days) · **valid** (shows the
proposed new email and a "Confirm email change" button — a deliberate
click, not an auto-apply on page load, so an email client's link-prefetch
can't silently trigger the change). Confirming re-validates the token
server-side, then: updates `auth.users.email` via the service-role Admin
API (`email_confirm: true`, no separate verification email), updates
`agents.email` to match, marks the request row confirmed, and writes an
`agent.email_changed` audit_log row. On success, shows the new email and a
link to `/login`.

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

### `/terms` and `/terms/accept` (P10, new)
`/terms` is a public, no-login page (same shape as `/privacy`, and kept in
sync with it — both are accepted together as one checkbox) covering
acceptable use, how `/privacy` fits in, an "as is" availability/liability
disclaimer, and Ontario governing law. Linked from the accept-invite
checkbox, `/settings`, and `/terms/accept`.

`/terms/accept` is the one-time gate for agents who joined **before**
`agents.terms_accepted_at` existed (or whose `acceptInvitation()` write
somehow didn't land) — `requireVerifiedAgent()` redirects here, right after
the MFA check, whenever that column is null. A single checkbox + "Agree and
continue" button calls `acceptTermsAction()` (a plain self-update, gated by
`grant update (terms_accepted_at) on public.agents to authenticated` plus
the existing `agents_update_self` RLS policy) and returns to `/today`. Like
`/mfa/setup` and `/mfa/verify`, it deliberately guards with the base
`requireAgent()`, not `requireVerifiedAgent()`, to avoid a self-redirect loop.

### `/feedback` (P10, new)
Reachable from the account menu ("Send feedback," every role, both mobile
and desktop — the same menu `/settings` and `/profile` use). A short form —
Type (Bug / Something not working / Feature request / General feedback /
Other — "Something not working" maps to the same `bug` category
server-side, it's just friendlier copy), Subject, Details — posts to the
`feedback` table (own-row insert, `org_id` derived from the agent) and
best-effort emails every active admin via the existing Resend `sendEmail()`
path (same "don't fail the user-facing action if the email fails" pattern as
`nudgeAgentAction`). See `/admin/feedback` in `docs/08-screen-specs.md` for
the admin-side view.

### `/profile`
Matches spec closely.
- Full name (editable — RLS column grants restrict `authenticated` UPDATE on
  `agents` to `full_name` only, so this is safe at the DB level, not just in
  the UI), email (read-only here — still no self-service change flow from
  `/profile` itself; the original spec's "change requires confirming both
  addresses" is now implemented, but only reachable admin-side, see
  `/admin/agents/[agentId]` below), role (read-only), joined date. **Fix,
  post-P12:** joined date was being run through the agent's own IANA time
  zone to display — `joined_at` is a `date` column with no time-of-day, and
  converting a date-only value through any negative-UTC-offset zone (every
  zone in the picker) silently shifts it back a calendar day, so every
  agent's own Profile page showed a "Joined" date one day earlier than
  reality. Now locked to UTC display instead (no zone conversion — there's
  no time-of-day to convert). Same fix applied to `/admin/agents/[agentId]`'s
  joined date below.
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
- **Import** — the "Import from spreadsheet" card that used to live here was
  **removed in P13c** (product request). The underlying `/import` flow is
  unchanged and still reachable from `/contacts` and `/clients` ("Import
  from Excel") — only this settings-page entry point is gone.
- **Your data** — "Download everything" (`GET /settings/export`, a single
  JSON bundle of every own-scoped table) only. The export is JSON only, not
  JSON+CSV as the original spec listed. "Delete my account" was **removed
  in P13c** (product request) — see below.

**P13c: self-service account deletion removed.** `delete_my_account()` (was:
see `docs/02-data-model.md` and `docs/04-security.md` for exactly what it
used to retain vs. erase) and the `/settings` "Delete my account" button/
dialog are gone outright — confirmed unreferenced by any other RPC, trigger,
or policy before dropping the function. An agent who wants their data gone
now goes through an admin.

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
  inline as an email-delivery fallback. **Fix, post-P12:** a Resend delivery
  failure (as opposed to Resend being unconfigured, which already no-oped
  safely) previously threw out of the server action unguarded — the
  invitation row was still created, but the SMD got an unhandled error
  instead of the invite link. Now caught: the invite still reports success
  and the link is still shown, with an inline "email failed, share link
  directly" note when delivery didn't go through.
- **`/team/members`** — matches spec's "active roster with Deactivate," plus
  a second, earlier-stage section not in the original design: a **team
  roster** (name/email/phone, no login) an SMD can populate *before* sending
  any invitation, with a "Send reminder" training-nudge action and an
  "Invite" action that promotes a roster row into a real invitation. This
  section's card title is the org's name (e.g. "Team Acme Insurance"), not
  the literal "Team roster" — P10, changed since it read as an unlabeled
  generic list next to the org-branded shell header above it. A
  roster entry disappears automatically once its email matches a joined
  agent. Deactivate confirms with the same "access revoked, history
  retained, disappears from the roster" copy the spec called for. As of the
  P9 security pass, roster update/delete/reminder actions are correctly
  scoped to the caller's own downline (see `docs/04-security.md` — this was
  one of the fixed gaps). **P11:** every roster member added here is now
  automatically enrolled in a Wednesday/Saturday training-reminder email —
  a small "Auto: Wed & Sat" badge on the row confirms it — independent of
  the manual "Send reminder" button and its cooldown (7 days, **shortened to
  1 day in P13b**), which stays as an on-demand option on top. See
  "Notifications" below for the mechanism.
- **`/team/audit`** — matches spec: goal changes, invitations, deactivations,
  who/what/when, org-scoped via a dedicated RLS policy (added since the
  original design — the audit table originally had only one, admin-global,
  SELECT policy). **P11:** the "Audit" quick-link was removed from the My
  Team page's button row (product request — an SMD reaching it by URL still
  works, it's just no longer a one-click nav item next to Members/Invites/
  Goals/Organization). **Fix, post-P12:** the "When" column was rendered
  server-side with no explicit time zone, so it showed in the server's own
  runtime zone (effectively always UTC) instead of the viewing SMD's — an
  action taken at, say, 3pm local could display as a different hour
  entirely. Now threads the viewer's own `time_zone` through
  `AuditLogTable`.

### Admin screens — grown well past the original one-line sketch
The original spec covered these in a single line each; they're now full
screens:
- **`/admin/orgs`** — "New organization" form (name, SMD name, SMD email) →
  provisions the org and sends the SMD invite; a flat "Existing" list of org
  names (no per-org detail/edit here yet). **P11 bug fix:** `provision_org`
  only ever created the org and a hashed invitation row — it never actually
  sent mail (no email dependency inside a DB function by design). The
  Server Action now sends the SMD their invite email itself, the same
  `inviteEmail()` template `/team/invites` uses; before this fix the SMD had
  no way to ever see their invite link.
- **`/admin/agents`** — cross-org (not downline-scoped) agent management,
  grouped by organization, with a separate **Admins** card at the top for
  admin accounts (P11: admins aren't part of any org, so they no longer sit
  inside a org-grouped card at all). Per agent: inline **role** select,
  inline **upline** select (move between uplines within the same org, hidden
  entirely for an admin row since admin has no upline), conditional
  **Reactivate**, and **Hard-delete** behind a dialog requiring the admin to
  type the agent's exact full name — explicitly distinguished in the dialog
  copy from deactivation ("permanently erases... not the same as
  deactivation"). All four mutating actions bypass RLS via the service-role
  client, gated entirely by the application-level `requireAdminActor()`
  check — see `docs/04-security.md` for why the MFA gap here mattered, and
  for the P9d cross-org fix on the underlying RPCs.
  - **P11: demoting an admin.** Since promotion nulls `org_id`/`upline_id`
    (see "Admin is not part of any organization" above), changing an
    admin's role to associate/leader opens a small dialog asking which
    organization they rejoin before the change applies — the role
    `<Select>` alone can't complete that transition anymore.
  - **P11, new: `/admin/agents/[agentId]`** — click any agent's name/email
    to open a per-agent record page: full record (email, role, org, upline,
    joined date), the same role/upline/reactivate/hard-delete controls
    embedded, and a **change email** action. The admin enters a new email
    and sends a confirmation link to it — the change is *not* applied
    immediately. The agent (not the admin) has to open that email and click
    "Confirm email change" (`/confirm-email-change/[token]`, no login
    required) before `auth.users.email`/`agents.email` actually update.
    While a confirmation is outstanding, the card shows who it's waiting
    on and when it was sent; sending again supersedes the wait. Backed by
    a new `agent_email_changes` table (hashed token, 7-day expiry, same
    shape as `invitations`), locked to the service-role client only — no
    RLS policies at all, same lockdown as `invitations`' token lookup.
- **`/admin/audit`** — same table component as `/team/audit`, unscoped
  ("everything, every organization"), capped at 500 rows vs. `/team/audit`'s
  200. Same viewer-timezone display fix as `/team/audit` above (this was the
  reported symptom: an admin's own audit entries showed a different time
  than when they actually made the change).
- **`/admin/pilot`** (new, not in the original spec at all) — a purpose-built
  dashboard for the P7 pilot-readiness question, not a stub: pulls a 10-
  business-day active-logger window per org, flags an org "at risk" (red)
  if fewer than two-thirds of active agents are hitting 8-of-10 days, with
  a per-agent per-day dot grid. Read-only. See `docs/06-build-phases.md`'s
  P7 entry — this page is that phase's stated instrument.
- **`/admin/feedback`** (P10, new) — every bug/issue/feature report from
  `/feedback`, unscoped across every organization, with a status
  `<Select>` per row. See `docs/08-screen-specs.md`.

---

## Notifications — matches spec closely

The three notifications, cadence, and content match the original design
exactly: evening nudge (weekdays 7 PM local, only if nothing logged that
day), Sunday summary (6 PM local, unconditional), Monday SMD digest (8 AM
local, leaders/admins only, unconditional). Role eligibility is enforced
structurally (`roleAllows()` — an associate is never eligible for the digest
and vice versa), which is also what guarantees "never more than one per
person per day" without needing separate logic for it.

**Known loose end, not fixed in P11:** `roleAllows()` still counts admin as
eligible for the Monday digest, unchanged. Now that admin has no downline
(`agent_closure` only has their own self-row), `composeMondayDigest()` /
`system_team_week_summary()` resolve to an all-zero team for them — so a
default-enabled admin still gets a Monday email, it's just a meaningless
one. Harmless (no crash, no data leak), but worth fixing by excluding admin
from `roleAllows('monday_digest', ...)` in a follow-up rather than folding
it into this pass.

**Mechanism, not in the original spec's level of detail:**
- Timezone resolution is per-instant via `Intl.DateTimeFormat` (handles DST
  automatically), defaulting to `America/New_York` if an agent has no time
  zone set. **Fix, post-P12:** the browser's/agent's zone is now captured at
  invite-accept time and auto-persisted the first time an existing agent
  (created before that capture existed) loads `/settings` — previously
  `agents.time_zone` stayed `null` until a manual visit to `/settings`,
  during which every scheduled send silently used the `America/New_York`
  default instead of the agent's real zone. The same pass fixed `todayIso()`
  (`lib/dates.ts`), which had been computing *UTC's* calendar day rather
  than the viewing/acting agent's local one — used app-wide for
  log/appointment/sale/recruiting date defaults, "date cannot be in the
  future" validation, and "today"/"this week" query boundaries, so this was
  wrong for roughly half of every day for any agent not in UTC. It also
  fixed `/admin/audit` and `/team/audit` (see below), `/profile`'s "Joined"
  date, and a few other server-rendered timestamps that either used the
  server's own runtime zone instead of the viewer's, or (a distinct bug)
  ran a `date`-only column like `joined_at` through an IANA zone at all,
  which silently shifts a date-only value back a calendar day in any
  negative-UTC-offset zone — every zone in the picker.
- Cron cadence: **pg_cron, inside Postgres** — not Vercel Cron, and, as of
  P14a, not GitHub Actions either. Vercel Hobby only allows daily schedules
  (too coarse for catching every agent's local send window); the interim
  GitHub Actions workaround was retired after its best-effort scheduler
  silently skipped a send window in production — see `docs/02-data-model.md`
  and `docs/06-build-phases.md`'s "P14" entry for the full story. Three
  pg_cron jobs now drive this: `enqueue-due-notifications` (every 5 min,
  pure SQL), `ping-notification-drain` (every minute, pg_net → the bulk-send
  route), and `ping-legacy-notifications` (every 5 min, pg_net → the
  roster/auto-nudge route). Same mechanism the `daily_metrics` pipeline's
  own cron jobs always used — there is now exactly one scheduler for this
  entire product. `ping-notification-drain` originally used a 6-field
  "every 30 seconds" pg_cron schedule; Supabase's managed pg_cron scheduler
  only polls at whole-minute boundaries and silently never fired it (caught
  after go-live — see the P14b migration), so it's a standard 5-field
  once-a-minute schedule like the other two.
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

**P11, new: automatic team_roster training reminders.** Distinct from the
three notifications above (which are per-agent, role/pref-gated) and from
the existing manual "Send reminder" button (`send_roster_training_reminder`,
rate-limited to once per 7 days per roster row — **shortened to once per day
in P13b**) — every `team_roster` entry
is now automatically enrolled in a recurring Wednesday/Saturday reminder the
moment an SMD adds them (`team_roster.auto_reminders_enabled`, default
`true`). This is the fix for the manual button's own limitation: an SMD had
no way to get a *standing* cadence going, only ad-hoc, cooldown-limited
nudges.
- Runs inside the same 15-minute cron route as the three notifications
  above, but as an independent pass that always executes regardless of
  whether any agent-level notification is also due that tick — Wed/Sat 9am,
  resolved against the roster entry's *upline's* time zone (a roster row has
  none of its own — it isn't a real login yet).
- Idempotency is the same insert-first unique-constraint shape as
  `notification_log`: a new `team_roster_reminder_log (roster_id,
  local_date)` table, one row per day actually sent.
- Uses the existing `rosterTrainingReminderEmail()` template (previously
  only reachable from the manual button) — no new copy.
- `/team/members` shows a small "Auto: Wed & Sat" badge on each roster row
  with this enabled, next to the existing "Invited" badge and the manual
  "Send reminder" button.

**P12a, new: automatic per-agent SMD nudge.** Same shape as the roster
reminders above, but for `nudge_agent`'s manual "Nudge" button (cooldown:
7 days, **shortened to 1 day in P13b**) on `/team`'s "Quiet — nothing logged
in 7+ days" list — an SMD can
now flip a persistent **"Daily reminders: On/Off"** toggle next to Nudge for
a quiet associate (`agents.auto_call_nudges_enabled`, default `false`,
`set_auto_call_nudges` RPC scoped to the caller's downline), and the cron
route emails that associate automatically every weekday evening from then
on until they start logging again — no further clicks required. The manual
Nudge button and its cooldown stay as the on-demand option on top.
- Reuses `evening_nudge`'s own 7pm-local/weekday send window
  (`kindsInWindow`) rather than a separate schedule, and skips anyone who
  already has activity logged today (same rule as `evening_nudge`) — both
  via a new `agent_auto_nudge_log (agent_id, local_date)` idempotency table,
  same insert-first shape as `notification_log`.
- **Shares `notification_prefs.evening_nudge`** rather than getting its own,
  unreachable opt-out: from the associate's side this is the same "reminder
  to log calls" concept whether the system or their SMD sent it, so turning
  off evening nudges in `/settings` (or via the email's unsubscribe link)
  stops both. An earlier version only checked the SMD's toggle, so an
  associate's own opt-out was silently ignored — fixed.
- Carries an unsubscribe link (reusing `evening_nudge`'s kind/token) since
  it's now a recurring send, unlike the manual Nudge button's email, which
  still has none (no standing preference to unsubscribe from a one-off).
- The cron route runs this pass only *after* the main per-agent loop
  finishes writing to `notification_log` for the tick, not concurrently
  with it — its own "did this associate already get the plain evening email
  this run" check reads that table, and running them concurrently let the
  read happen before the write, occasionally double-emailing an associate
  with both the toggle and their own `evening_nudge` preference on. Fixed
  by sequencing the two passes; `team_roster`'s Wed/Sat pass stays
  concurrent since it shares no state with either.
- No pgTAP coverage yet for the new schema (`auto_call_nudges_enabled`,
  `agent_auto_nudge_log`, `set_auto_call_nudges`) — same gap as P11's
  admin/org-detachment schema, see `TODOS.md`.

---

## The app shell — admin's nav is a separate set now, not an addition (P11)

**Mobile** — bottom tab bar for associate/leader: **My Day · Activity Logs
· Contacts · My Dashboard**, plus **My Team** for leaders. The centre-
weighted **Log** tab described in the original spec is now a "Log Activity"
action that opens a shared dialog rather than navigating to a page — same
job (fastest path to logging), different mechanism. Avatar top-right opens
the account menu (profile/settings/**send feedback**/sign out — "Send
feedback" → `/feedback`, P10, every role including admin).

**For admin, the tab bar is entirely different, not the associate/leader
set plus extras:** **Orgs · Agents · Audit · Pilot · Feedback** (the five
`/admin/*` screens from "Admin screens" above) — admin has no personal "My
Day," logs no activity of their own, and (P11) isn't part of any
organization, so none of My Day/Activity Logs/Contacts/My Dashboard/My Team
apply. The account menu also drops the "Log Activity/Meeting Notes/Clients"
mobile-only group for admin, for the same reason. This nav previously
appended **My Team** to the associate/leader set for admin (since admin
used to pass `requireLeader()`) — that's gone; see "Admin is not part of
any organization" above.

**Desktop** — left rail mirrors the same split: associate/leader get the
primary items plus a secondary group (Log Activity, Meeting Notes, Clients)
that doesn't fit the mobile tab bar's five slots (those three surface on
mobile via the account menu instead); admin gets only the five `/admin/*`
items, no secondary group.

**Header branding** — the shell header shows the signed-in agent's org logo
(or a generic mark) and org name, linking to `/today`. For admin (P11, no
org to show), it falls back to the same generic mark and the literal
"Performance Tracker" label — the existing no-logo-uploaded fallback, not a
new admin-specific treatment — and the link goes to `/admin/agents` instead
of `/today`.

**Post-auth landing** — every hardcoded redirect that used to send a
freshly-authenticated or freshly-verified session to `/today` (root URL,
password sign-in, MFA enrollment success, magic-link `emailRedirectTo`, the
one-time terms-accept gate) still targets `/today` first, but `/today`
itself now redirects an admin session straight on to `/admin/agents` —
one central catch point rather than teaching every caller about admin.

**Route guards** — implemented as a layered chain in `src/lib/auth/guards.ts`:

```
requireAgent()          → any signed-in, active agent
requireVerifiedAgent()  → requireAgent() + must be MFA-verified this session
requireLeader()         → requireVerifiedAgent() + role === leader
requireAdmin()          → requireVerifiedAgent() + role === admin
```

**P11: `requireLeader()` no longer admits admin** (it used to allow
`role in ('leader', 'admin')`). Every `/team/*` screen — org-scoped
downline/roster/targets pages an org-less account has no use for — is
SMD-only now; admin's equivalent tools live entirely under `/admin/*`,
gated by `requireAdmin()`, which is unchanged.

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
