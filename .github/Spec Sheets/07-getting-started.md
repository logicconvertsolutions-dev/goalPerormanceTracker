# Kicking this off in Claude Code

## Step 0 — before you open Claude Code (20 min, do it yourself)

```bash
mkdir wfg-team-tracker && cd wfg-team-tracker && git init
mkdir docs
# copy CLAUDE.md to the root and the 00–10 files into docs/
cat > .claudeignore <<'IG'
node_modules/
.next/
dist/
coverage/
*.lock
supabase/.temp/
types/database.ts
IG
git add -A && git commit -m "spec"
```

Also do these by hand — do not let an agent do them:
- Create the Supabase project (region: **ca-central-1**, Toronto — data residency
  matters for the PIPEDA story you will tell the SMDs).
- Put the keys in `.env.local`. Add `.env*` to `.gitignore` **before** the first commit.
- In Supabase dashboard → API settings, confirm `private` is **not** in Exposed schemas.
- `npm i -g supabase` and `supabase login`, `supabase link`.

Claude Code should never see or handle the service-role key.

## How to run sessions

- **One phase per session.** `/clear` between phases. Never `/compact` mid-phase —
  you lose the schema detail that makes the policies correct.
- **Plan mode first on P1 and P5.** `shift+tab` into plan mode, read the plan,
  correct it, *then* let it write. Accept diffs, not essays.
- Model: **Opus** for P1 and the import parser. **Sonnet** for everything else.
- Commit after every green DoD.
- When it drifts: `re-read docs/0X and tell me which rule you just broke` beats
  arguing.

---

## Session 1 — P0 scaffold (Sonnet)

> Read CLAUDE.md. This repo is empty except for the spec in docs/.
>
> Scaffold P0 only, per docs/06-build-phases.md: Next.js 14 App Router with
> TypeScript strict, Tailwind, shadcn/ui init, Vitest, Playwright, `supabase init`.
> Add the design tokens from docs/03-ui.md to tailwind.config.ts and wire Plus
> Jakarta Sans + JetBrains Mono. Add a GitHub Actions workflow running typecheck,
> lint, and build.
>
> Do not create any database tables, routes, or UI beyond a single styled
> placeholder page. Stop when `npm run dev` renders it and CI passes.

## Session 2 — P1a: schema + hierarchy (Opus, plan mode)

> Read CLAUDE.md and docs/02-data-model.md in full. Plan mode first — do not write
> files yet.
>
> Plan the P1 migrations: organizations, agents, agent_closure, contacts, the
> four activity tables (with contact_id and follow_up_on), targets, invitations,
> audit_log, daily_metrics, private.metrics_dirty.
> Include the closure-maintenance trigger with the cycle guard, the same-org
> trigger, and the org_id auto-fill triggers.
>
> Output the plan as a list of numbered migration files with a one-line purpose
> each. Tell me anything in the spec that is ambiguous or that you think is wrong
> before you write a line of SQL.

Then, after you have corrected the plan:

> Write those migrations as `supabase/migrations/*.sql`, one concern per file,
> each idempotent and re-runnable against `supabase db reset`. No RLS policies
> yet — that is P1b. Then write `supabase/seed.sql` creating two organizations:
> org_x (smd_x → assoc_1, assoc_2; assoc_1 → assoc_1a) and org_y (smd_y →
> assoc_3), with a month of realistic activity for each.

## Session 3 — P1b: RLS + pgTAP (Opus, plan mode)

> Read CLAUDE.md, docs/02-data-model.md, and docs/05-testing.md.
>
> Add RLS to every public table exactly as specified, plus the private helper
> functions. Every security definer function needs `set search_path = ''` and
> fully-qualified names. Include the column-level grants and the
> `guard_agent_privileged_columns` trigger on public.agents — RLS alone does not
> stop an associate from updating their own `role`.
>
> Then write the full pgTAP suite from docs/05-testing.md section 1 — including
> the cross-org cases and the return-shape assertion that no RPC exposes
> contact_name, client_name, prospect_name, or notes.
>
> I expect some tests to fail on the first run. Show me the failures before
> fixing them; do not change a test to make it pass without telling me why.

That last sentence matters. An agent that edits the assertion instead of the
policy will hand you a green suite and an open database.

## Session 4 — P1c: daily_metrics pipeline (Opus)

> Read docs/02-data-model.md, the Scale section.
>
> Implement the dirty-queue pipeline: AFTER triggers on the four activity tables
> that enqueue (agent_id, date) — including OLD.date on update and delete — a
> drain function that recomputes one agent-day idempotently, the pg_cron job at
> one-minute cadence, and the nightly 3-day reconcile.
>
> Expose the drain as an RPC so tests can invoke it synchronously instead of
> waiting on cron.
>
> Then write the fuzz test: 500 random insert/update/delete operations across the
> activity tables, then assert daily_metrics equals a from-scratch recompute.
> Then seed 200 agents × 250 days × 10 calls and report roster query timings with
> EXPLAIN ANALYZE.

**Do not start P2 until that seed produces a roster under 300 ms.**

## Session 5 — P2 auth and shell (Sonnet)

> Read CLAUDE.md, docs/09-account-and-auth.md, and docs/10-journeys.md.
>
> Build every screen in 09 — login, magic link, accept-invite, onboarding,
> forgot/reset password, MFA setup with recovery codes, profile, settings,
> logout, /team/invites, /team/members, /admin/orgs — plus the app shell and
> route guards. Use the exact error copy specified; do not invent friendlier
> wording that leaks whether an account exists.
>
> Build every empty state named in 09 with its call to action. Stop at the P2
> DoD in docs/06-build-phases.md.

## Session 6 — P2.5 contacts and follow-ups (Sonnet)

> Read docs/10-journeys.md first, then docs/08-screen-specs.md.
>
> Implement contacts with find-or-create on log, the follow_up_on field with its
> quick chips, the /today callback queue with snooze and mark-done, back-dating
> on /log, and contact detail with full per-person history.
>
> This is the feature the product exists for. If any part of the spec makes the
> "call back on Monday → appears Monday" loop slower than two taps, tell me
> before building it.

## Sessions 7+ — one per phase from docs/06-build-phases.md

Same shape every time:

> Read CLAUDE.md and docs/0X. Implement phase PN only, per
> docs/06-build-phases.md. Stop at its Definition of Done and show me the DoD
> checks passing. Do not start the next phase.

## Manual steps outside Claude Code (updated after P5.5)

Things only a human can do — Claude Code has no browser, no email inbox, and
(depending on the session) no persistent shell across sessions. Re-check this
list before every deploy.

**Done / connected as of P5.5:**
- Supabase is connected (MCP connector) — project `arswptuybizvceabecyn`,
  region ca-central-1. Migrations through P5.5 are applied directly via MCP,
  including two hotfixes (`p5b`, `p5c`) that existed on the remote DB but had
  no local migration file until this session reconciled them.

**Still to do:**
- **Vercel**: no project exists yet for this repo under the connected
  account. Create one (import this GitHub repo). Set the production env
  vars below in the Vercel dashboard.
- **Notifications cron moved off Vercel Cron**: Vercel's Hobby plan only
  allows once-a-day cron schedules, but `/api/cron/notifications` needs a
  15-minute cadence to catch each agent's local-time send window across
  time zones (`src/lib/notifications/window.ts`). `vercel.json` was removed;
  `.github/workflows/notifications-cron.yml` now hits the route every 15
  minutes instead, authenticated with the same `CRON_SECRET`. Needs two
  **GitHub repo secrets** (Settings → Secrets and variables → Actions):
  `CRON_SECRET` (same value as the Vercel env var below) and
  `CRON_TARGET_URL` (`https://<your-app>.vercel.app/api/cron/notifications`).
- **Resend** (or another transactional email provider): create an account,
  verify a sending domain, get an API key. Without `RESEND_API_KEY` set, the
  cron route and the Nudge button both run for real (compose, rate-limit,
  log to `notification_log`) but skip the actual send with a console warning
  — safe, but no email reaches anyone.
- **Env vars to set in Vercel** (see `.env.example` for the full list):
  `RESEND_API_KEY`, `NOTIFICATIONS_FROM_EMAIL`, `NOTIFICATIONS_UNSUB_SECRET`
  (`openssl rand -hex 32`), `CRON_SECRET` (also random — Vercel sends it back
  as a bearer token automatically once set), `NEXT_PUBLIC_APP_URL`.
- **Supabase Auth → Providers → Password**: enable "Leaked password
  protection" (HaveIBeenPwned check). Flagged by the security advisor; not
  settable via SQL/migration, dashboard-only.
- **P6 pre-launch gate** (`docs/04-security.md`): a restore drill (trigger a
  Supabase backup restore once, confirm it works) has to be done by hand
  against the dashboard — not something a migration or a script can prove.
- **GitHub repo secrets for CI** (added in P6, `.github/workflows/ci.yml`):
  `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF` — without them the
  Supabase advisor-lints CI step skips itself instead of gating the build,
  which the security doc calls for ("CI fails on Supabase advisor lints").
  Generate the access token from the Supabase dashboard (Account →
  Access Tokens); project ref is `arswptuybizvceabecyn`.
- **`npm ci` was silently broken since P0**: `package-lock.json` was
  gitignored and never committed, but CI calls `npm ci`, which requires one.
  Fixed this session (lockfile now committed) — confirm the next CI run on
  this branch actually gets past the install step; it may not have since
  the repo's first commit.

**P7 (pilot) — nothing here can start until the manual steps above are
done.** The pilot needs a real, reachable, emailing deployment; there's no
version of "run the pilot" that happens inside this sandbox. Once Vercel +
Resend are live:
1. Provision Deepak's org via `/admin/orgs` (or `provision_org` directly) —
   this sends the SMD invite email, so it needs Resend actually configured
   first, or the invite link has nowhere to go.
2. Accept that invite as Deepak, then invite the 2 associates from
   `/team/invites`.
3. All three log real activity for two weeks. Check `/admin/pilot` (new
   this session) partway through and at the end — it shows daily active
   logging per agent over the last 10 business days and flags it red if
   fewer than two thirds of an org's active agents are hitting 8 of 10.
   Per `06-build-phases.md`: if that's red, the fix is P3 (the logging
   flow), not a new feature.

## Prompts worth keeping around

- `Regenerate types and show me what changed in the schema.`
- `Run supabase db lint and the advisors. Fix only what they flag.`
- `Show me every place a dashboard query touches call_logs instead of daily_metrics.`
- `Grep the client bundle for anything matching a service key pattern.`
- `What in the last hour of work is not covered by a test?`
