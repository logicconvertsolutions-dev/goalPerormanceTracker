# Build phases

One phase per Claude Code session. `/clear` between phases. Do not start a phase
before its predecessor's DoD is green — RLS bugs are cheap now and expensive later.

**Status as of 2026-08-31: P0 through P7 shipped as planned below. P8
through P11 followed as unplanned post-launch iteration** — real bugs and
feature requests surfaced by QA, security review, and early use, not phases
anyone scoped in advance. They're documented after P7 rather than folded
into this file's phase structure, because that structure stopped being how
work actually got sequenced once the app was live. See
`docs/02-data-model.md` for the schema those four produced.

## P0 — Foundation (0.5 day) — ✅ done
Next.js 14 + TS strict + Tailwind + shadcn scaffold · `supabase init` ·
`CLAUDE.md` + `.claudeignore` · CI skeleton (typecheck, lint, build) ·
design tokens in `tailwind.config.ts` · fonts.
**DoD:** `npm run dev` renders a styled placeholder; CI green.

## P1 — Schema, hierarchy, RLS (2–3 days) — ✅ done ← the load-bearing phase
All tables, enums, indexes · `organizations` + same-org trigger · closure trigger
with cycle guard · `daily_metrics` + dirty queue + drain function + pg_cron jobs ·
`private` helper functions incl. `effective_target` · every policy · seed script
with two orgs · full pgTAP suite from `docs/05-testing.md` including the
`daily_metrics` fuzz test.
**No UI in this phase.** If you are tempted to build a screen, you are stalling.
**DoD:** pgTAP green, advisors clean, `npm run types` emits `types/database.ts`,
and a 500k-row seed produces a roster in under 300 ms.

## P2 — Auth, account, and shell (2–3 days) — ✅ done
Every screen in `docs/09-account-and-auth.md`: login, magic link, accept-invite,
onboarding, forgot/reset password, MFA setup with recovery codes, profile,
settings, logout, `/team/invites`, `/team/members`, `/admin/orgs`. Plus the app
shell — bottom tab bar on mobile, left rail on desktop — and route guards.
**DoD:** E2E test 1 passes; a leader cannot reach `/team` without MFA; an
associate hitting `/team` is redirected, not 403'd.

## P2.5 — Contacts and follow-ups (1–2 days) — ✅ done ← do not skip this
`contacts` table and find-or-create on log · `follow_up_on` · the `/today`
callback queue with snooze and mark-done · back-dating on `/log` · contact
detail with full history.
**This is the product's reason to exist** (see `docs/10-journeys.md`). Shipping
logging without follow-ups gives you a spreadsheet with a login page.
**DoD:** log a call with "call back Monday", see it on `/today` on Monday, tap
through to a pre-filled log form.

## P3 — Associate logging + import (2 days) — ✅ done
Quick-log screen · CRUD for all four logs · spreadsheet import with dry-run
(creates contacts from the workbook's name column) · offline queue + PWA
manifest · golden-file test against the real workbook.
**DoD:** log a call on a phone in five taps; the P3 half of the golden-file test
is green — imported workbook produces `daily_metrics` and derived values equal to
the workbook's Dashboard tab. No dashboard UI required for this.

## P4 — Associate dashboard + list filters (2 days) — ✅ done
Per `docs/08-screen-specs.md`: the shared `<FilterBar>` with URL search-param
state, KPI cards, the five charts, and filters + summary strips on the call,
appointment, sales, and recruiting lists.
**DoD:** the P4 half of the golden-file test is green — the rendered dashboard
displays the numbers P3 already proved correct; axe-core clean on `/dashboard`.

## P5 — SMD dashboard (2 days) — ✅ done
`team_week_summary` and friends · roster with sort/filter/colour bands · agent
multi-select and date filters · Summary/Daily view toggle · filter-to-one-agent
view reusing the P4 dashboard components · quiet-agent list · org-default and
per-agent target management · CSV export.
**DoD:** E2E tests 2 and 3 pass; roster under 300 ms at seeded scale.

## P5.5 — Notifications (1 day) — ✅ done
The three emails in `docs/09-account-and-auth.md` (evening nudge, Sunday summary,
Monday SMD digest), per-user toggles, one-click unsubscribe, and the SMD's
per-agent Nudge button. Rate limits enforced server-side, not in the UI.
**DoD:** each email sends once, respects the toggle, and never fires on a day the
person already logged.

## P6 — Admin + hardening (1 day) — ✅ done
Agent lifecycle, upline moves, audit viewer · security headers · rate limits ·
retention job · export/delete · privacy notice · `docs/incident-response.md` ·
restore drill.
**DoD:** the pre-launch gate in `docs/04-security.md`.

## P7 — Pilot — ✅ instrumentation shipped
Deepak + 2 associates for two weeks before the SMD ever sees it. Instrument
**daily active loggers**, not signups. If fewer than 2 of 3 log on 8 of 10
working days, the problem is the logging flow — fix P3, do not build features.
`/admin/pilot` (built this phase) is that instrument: daily active-logger
status per org over the last 10 working days, red-flagged under the 8-of-10
threshold. Whether the pilot itself has run, and with what result, is
Deepak's call to report — this file only tracks that the tool exists.

---

## P8 — Recruiting vocabulary + org branding (unplanned)
`recruit_status` enum gained values beyond the original five (see
`docs/02-data-model.md`) to match how recruiting conversations actually
progress, plus an org logo with a size cap. Small, single-migration scope —
never got its own multi-day plan the way P0–P7 did.

## P9 — Contacts phone, team roster, and a security pass (unplanned)
Six migrations, largely QA- and security-review-driven rather than planned
feature work:
- `contacts.phone` added — the original P1 schema deliberately omitted phone
  to keep PIPEDA surface small; revisited and added as mandatory once contact
  import needed it to de-duplicate people reliably.
- `team_roster` + `agent_training_reminders` — lets an SMD add prospective
  team members to a roster before they're invited, with training-reminder
  nudges for people who haven't accepted yet. New concept not in the original
  two-tier (agent / contact) data model.
- Three security-fix migrations closing gaps a CSO-style audit found:
  cross-org scoping holes in `admin_move_agent` / `admin_reactivate_agent`
  and `team_roster` read/write, and a rate-limit race in the nudge and
  training-reminder RPCs. Precise before/after for each is in
  `docs/04-security.md`.

## P10 — Feedback, terms acceptance, and a round of UX fixes (unplanned)
One migration set plus a batch of product/UX requests, not a planned
multi-day phase:
- `feedback` table + `/feedback` (account menu, every role) and
  `/admin/feedback` (list + status) — bug/issue/feature reports, emailed to
  every active admin via the existing Resend `sendEmail()` path.
- `agents.terms_accepted_at` + `/terms` (content) + `/terms/accept` (one-time
  gate for pre-existing agents, same shape as the MFA gate) — the accept-invite
  checkbox previously gated only the client submit button and recorded
  nothing; `acceptInvitation()` now rejects a missing agreement server-side
  (`z.literal(true)`) and stamps the timestamp itself for new agents.
- `/team/members`'s "Team roster" card retitled to "Team {org name}".
- `PageHeader` stacks title/actions vertically below `sm:` instead of forcing
  a `shrink-0` action row beside the title — fixes header buttons overflowing
  on `/contacts` (and every other page using the shared header) on narrow
  screens.
- `DailyBreakdownTable` (both `/dashboard`'s and `/team`'s Activity views)
  gained a Total row/card.
- `/login` copy de-emphasized "log calls" for generic performance-tracking
  language.
- Log Call: `ContactPicker` gained an `onSelect` callback and
  `searchContactsAction` now returns each contact's most recent call source;
  picking an existing contact with a known source auto-fills and collapses
  the Source field (with a "Change" escape hatch) instead of asking again.
- Meeting Notes: appointment `appt_type` moved out of the Details column into
  the Actions column, alongside the follow-up line, so the sheet shows what
  was actually done (e.g. "Solutions Presented").

No RLS/security-fix work this round — see `docs/04-security.md` if that
changes.

## P11 — Admin/org detachment, agent email change, and email-delivery bug fixes (unplanned)
Three migrations plus a batch of product requests, not a planned multi-day
phase. The largest structural change since P2's original shell design — see
`docs/09-account-and-auth.md`'s "Admin is not part of any organization" for
the full narrative:
- `agents.org_id`/`upline_id` are now nullable, but only for `role =
  'admin'` — enforced by two new check constraints, not just app code.
  Existing admins (and any of their own direct reports) were backfilled to
  match. Promoting an agent to admin nulls both columns and surfaces any of
  their direct reports as top-level; demoting one back out requires picking
  an org for them to rejoin. `invitations.org_id` got the same nullable
  treatment (an admin inviting another admin has no org to stamp it with),
  and `feedback.org_id` too (an admin can still submit feedback, unlike
  every other owner-scoped table, which stays raising-on-null — that's what
  keeps admin from ever logging activity of their own).
- Caught in the same pass, before it shipped as a live bug: `admin_move_agent`
  / `admin_reactivate_agent` / `admin_hard_delete_agent` / `admin_set_agent_role`
  all used "target agent's `org_id` is null" as their not-found check —
  which a real admin row now legitimately trips. Re-keyed to check row
  existence directly.
- Admin's nav is now a distinct set (Orgs · Agents · Audit · Pilot ·
  Feedback) that *replaces* the associate/leader tab bar/rail instead of
  extending it, and `requireLeader()` no longer admits admin — every
  `/team/*` screen is SMD-only now, admin's tools are entirely under
  `/admin/*`.
- `/admin/agents/[agentId]` (new) — a per-agent record page, reached by
  clicking an agent on `/admin/agents`, with a "change email" action:
  admin proposes a new email, the agent confirms it via a mailed link
  (`/confirm-email-change/[token]`, no login required) before it actually
  takes effect in `auth.users`/`agents.email`. New `agent_email_changes`
  table, same hashed-token/service-role-only shape as `invitations`.
- **Bug fix:** `provision_org` (admin's "New organization" form) only ever
  created the org and a hashed invitation row — it never sent the SMD their
  invite email. The Server Action now sends it, reusing the same
  `inviteEmail()` template `/team/invites` uses.
- **Bug fix:** the feedback-to-admins notification (`/feedback` →
  every active admin) used `Promise.all` across all admin recipients — one
  bad/bouncing address failed the whole batch silently. Switched to
  `Promise.allSettled` so one admin's delivery failure can't sink everyone
  else's.
- `team_roster` members are now automatically enrolled in a Wednesday/
  Saturday training-reminder email (`auto_reminders_enabled`, default
  `true`) the moment an SMD adds them — new `team_roster_reminder_log`
  table for idempotency, independent of the existing manual "Send reminder"
  button and its 7-day cooldown.
- Removed the "Audit" quick-link from the SMD's My Team page button row
  (product request; `/team/audit` itself is unchanged, just no longer a
  one-click nav item there).

No security-audit-driven work this round (P11c's not-found fix was
self-caught during the org_id migration, not an external finding) — see
`docs/04-security.md` if that changes.

## P13 — Contact phone reversed again, daily reminders, self-delete removed (unplanned)
Three migrations, all product-requested bug fixes rather than planned feature
work — see `docs/02-data-model.md`'s "P13" section for full detail:
- `contacts.phone`/`phone_normalized` dropped again (reversing P9a), taking
  any existing phone data with them; `contacts.notes` added in its place,
  captured on Add contact and searched from `/contacts` alongside name.
  Every create/import path (manual, device Contact Picker, Excel importer)
  no longer asks for, shows, or stores a phone number.
- `nudge_agent()` / `send_training_reminder()` / `send_roster_training_reminder()`
  cooldown shortened from 7 days to 1 day (same atomic P9f/P9e shape, just a
  shorter interval) — SMDs asked to be able to nudge/remind daily instead of
  weekly. The automatic Wednesday/Saturday roster reminder (P11a) is
  unaffected.
- `delete_my_account()` and its `/settings` "Delete my account" button
  removed outright — confirmed unreferenced elsewhere before dropping.
- `/logs`' Calls tab gained a Source filter (same enum as Log a call's
  Source field), client-driven via a small `CallsSourceFilter` so it
  actually re-queries on change (unlike `/appointments`' plain-form status
  filter).

## P14 — Bulk-load-safe notification pipeline + GitHub Actions retired (unplanned)
One migration, driven by a live incident: an associate's 7pm evening_nudge
was silently dropped because GitHub Actions' `schedule:` trigger (explicitly
best-effort) skipped the exact 15-minute window it needed. Investigating
that surfaced a second, bigger problem: the per-agent send path did "who's
due" and "send everyone's email" inside one HTTP request, which would also
break outright at real scale (thousands of agents, sequential per-recipient
Resend calls, one serverless function's execution-time limit). Product
decision on top of both fixes: no more dependency on GitHub Actions for
scheduling at all, so there's exactly one place (pg_cron, inside Postgres)
where every recurring job in this product lives and gets maintained — see
`docs/02-data-model.md`'s "P14a" section for the full design.
- `private.enqueue_due_notifications()` (pg_cron, every 5 min, pure SQL) +
  a `pgmq` queue (`notification_sends`) + `/api/cron/notifications/drain`
  (pg_cron → `pg_net` → bounded-batch Resend `/emails/batch` sends) replace
  the old per-agent loop in `src/app/api/cron/notifications/route.ts` for
  evening_nudge/sunday_summary/monday_digest.
- `notification_log` gained `status`/`attempts`/`last_error` — a row now
  means "claimed," not "confirmed sent," now that claiming and sending are
  two different processes.
- `src/lib/notifications/eligibility.ts` (`agentsDueNow`) is deleted —
  reimplemented as SQL inside `enqueue_due_notifications()`, since that's
  now the only place it runs. `window.ts` stays — `kindsInWindow`/
  `isRosterReminderWindow` are still used by the roster/auto-nudge paths
  that didn't move onto the queue — but both were widened from an exact
  15-minute slot to the same self-healing "any time from the target hour
  through end of local day" shape `enqueue_due_notifications()` uses.
- team_roster auto-reminders (P11a) and `auto_call_nudges` (P12a) keep
  their original request-per-tick logic, unbatched, in the same (now much
  smaller) route — neither is bounded by the full agent base, so neither
  needed the queue. What changed for them is only the trigger.
- **GitHub Actions retired entirely**: `.github/workflows/notifications-
  cron.yml` is deleted. A new `private.ping_legacy_notifications()` (pg_cron,
  every 5 min) now triggers the roster/auto-nudge route instead, sharing
  the same `private.ping_app_route()` helper and Vault secrets
  (`app_base_url`, `cron_secret`) as the drain-route pinger. No scheduled
  job in this product depends on GitHub Actions anymore — all of them are
  pg_cron, alongside `daily_metrics`' own three jobs.
- Manual, un-migrated follow-up: two Vault secrets (`app_base_url`,
  `cron_secret`) must be created once via the SQL editor before either
  ping function does anything — see the migration file's own trailing
  comment. Until then both no-op harmlessly on every tick; `enqueue-due-
  notifications` keeps claiming and queuing regardless, so nothing is lost,
  it just doesn't go out yet.

---

## Working with Claude Code on this repo (token discipline)
> Session-by-session prompts live in `docs/07-getting-started.md`. If the two
> ever disagree, that file wins for *how to run a session*; this one wins for
> *what a phase contains*.
- `CLAUDE.md` stays under ~100 lines. Everything else lives in `docs/` and is
  read only when the task needs it. CLAUDE.md is re-sent every turn; `docs/` is not.
- `.claudeignore`: `node_modules/ .next/ dist/ coverage/ *.lock supabase/.temp/
  types/database.ts` (regenerate it, don't read it).
- Model routing: Sonnet for CRUD, forms, and tests. Opus for P1 (RLS design) and
  the import parser. Haiku for mechanical renames.
- One phase per session, then `/clear`. Never `/compact` mid-phase — you lose the
  schema details that make the policies correct.
- Ask for a plan before edits on P1 and P5; accept the diff, not the essay.
- Disable MCP servers you are not using in this repo — each adds tool-definition
  tokens to every message.
- Commit after every green DoD, so a bad session is one `git reset` away.
