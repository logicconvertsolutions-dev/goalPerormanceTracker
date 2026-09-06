# Kautis (Goal Performance Tracker) — Claude Code project memory

Multi-tenant callback queue and activity tracker for WFG teams. An associate
opens it to see **who to call today**; the metrics are a by-product. They log
calls / appointments / sales against **contacts** (people, not rows). Their
SMD sees **aggregate** performance — per day, per week, filterable to one
agent — and never prospect PII. Two customer organizations share one
database; they must never see each other.

## Stack (locked — do not re-litigate)
Next.js 15 App Router · TypeScript strict · Supabase Pro (Auth + Postgres +
RLS) · Tailwind + shadcn/ui · Recharts · Zod · Vercel · Resend (transactional
email).
(Started on Next.js 14 per the original P0 scaffold; upgraded to 15 during
build-out. `package.json` is the source of truth if this drifts again.)
**Light theme only** (see `.github/Spec Sheets/03-ui.md` — supersedes an
earlier dark-theme direction shipped through P0–P2). No second theme, no
theme toggle in v1.

## Environments
- `master` → production (Vercel production deployment + Supabase production project). Protected: requires a PR and passing `ci (18.x)`/`ci (20.x)` checks — no direct pushes, no bypass, including for admins.
- `staging` → sandbox (isolated Supabase branch + `staging.kautis.ca`). Prove changes here before merging to `master`.

## Git workflow
Feature branches always branch off `dev`, never off `staging` or `master`
directly. Promotion always flows one direction, in order: `dev` → `staging`
→ `master`. Never skip a stage (e.g., never merge a feature branch straight
into `staging` or `master`).

When asked to "push changes," "deploy," or similar without further
specification, this means: merge the feature branch into `dev`, push,
verify, then promote `dev` → `staging` (push, verify against the actual
database — not just the status field), then `staging` → `master` (via PR,
since `master` is protected — never attempt a direct push to `master`).

After every merge into `master` or `staging`, immediately sync the other
two branches to match, in the same sitting — don't leave `dev`/`staging`/
`master` diverged even briefly. Verify a sync actually happened by checking
real file content/bytes, not by trusting "Already up to date" (it can lie
if your local branch was stale — always `git pull` before merging).

## Non-negotiable rules
1. **RLS is the security boundary.** Never rely on client filtering. Every
   `public` table has RLS enabled + explicit policies. RLS is *row*-level —
   where a user can update a row they own, protect privileged columns with
   grants and a trigger, not a policy.
2. **Uplines never read prospect rows.** Team data reaches leaders only via
   `SECURITY DEFINER` RPCs that return counts/sums. No `contact_name`,
   no `notes`, no `client_name` crosses the hierarchy boundary.
3. Every `SECURITY DEFINER` function: `set search_path = ''`, fully-qualified
   table names, created in `private` schema unless it must be RPC-callable.
4. **When revoking function/table access, name `anon` and `authenticated`
   explicitly.** `REVOKE ALL ... FROM PUBLIC` does NOT undo a grant made via
   `ALTER DEFAULT PRIVILEGES ... TO anon/authenticated` — that's a direct
   grant to the named role, not one inherited via `PUBLIC` membership. This
   caused real, silent RLS/pgTAP failures once already (see git history
   around the `pgmq` and `explicit_role_revokes` migrations) — always revoke
   from `PUBLIC, anon, authenticated` by name on anything meant to be
   service-role-only.
5. Service-role key is server-only. Never in a `NEXT_PUBLIC_` var, never in a
   client component, never in an artifact.
6. Server Components by default. `'use client'` only for interactivity.
7. All mutations are Server Actions with Zod input validation.
8. **Every table carries `org_id`; every policy and RPC checks it**, on top of
   the hierarchy check. Two independent fences.
9. Targets are set by the SMD (org default + per-agent override), versioned by
   `effective_from`. Never mutate a past target row. Resolve them only through
   `private.effective_target()`.
10. **Dashboards read `daily_metrics`, never raw activity tables.** The only
    exception is an agent's own numbers for today. If you find yourself
    aggregating `call_logs` in a dashboard query, stop — you are bypassing the
    read model.
11. No new dependency without asking.

## Database changes — mandatory workflow
Never modify the Supabase schema or data directly. `apply_migration` and
`execute_sql` MCP tools are blocked in `.claude/settings.json` — this is
enforced at the tool-call level (confirmed via a live test), not just
requested in writing.

## Known gotchas — Supabase branching & migrations (learned the hard way, 2026-09-06)

Read this before touching branch creation, migration dumps, or anything that
touches both `master` and `staging` in the same session. Every item below
cost real time once already.

**Dumped SQL is not automatically safe to re-run against a database that
already has the objects.** `CREATE TABLE IF NOT EXISTS` guards the table, but
a separate `ALTER TABLE ... ADD GENERATED ALWAYS AS IDENTITY`, `ADD
CONSTRAINT`, or a bare `CREATE INDEX` right after it does NOT inherit that
guard — each needs its own (`CREATE INDEX IF NOT EXISTS`, or a `DO $$ IF NOT
EXISTS (SELECT 1 FROM pg_constraint/pg_attribute ...) THEN ... END IF; END
$$;` block for constraints/identity columns). This broke production's
migration pipeline for real once (`pgmq` schema file) — check every
`ALTER`/`CREATE` in a freshly-dumped file for this before trusting it.

**Creating a genuinely persistent Supabase branch requires the CLI, not the
dashboard.** As of this writing, the Branches dashboard page has no "create"
button under "Persistent Branches" — only under "Preview Branches" (which are
short-lived). Use `supabase branches create <name> --persistent` instead, then
link it to a git branch via the dashboard afterward if it doesn't prompt for
one. Verify the result via the Management API/MCP `list_branches` call and
check `"persistent": true` — don't trust a dashboard checkbox alone, it has
been misleading before.

**A dashboard "reset branch" action does not re-run migrations.** It can
leave the branch's database genuinely empty (zero tables, zero rows in
`supabase_migrations.schema_migrations`) while its status still reports
`FUNCTIONS_DEPLOYED`. Don't trust that status field alone — verify with an
actual table list or a `select version from
supabase_migrations.schema_migrations` query. To force a real
Clone→Pull→Migrate run once a branch is git-linked, push any commit
(`git commit --allow-empty` is fine) to its linked branch.

**"Automatic branching" (PR-preview branches) and a manually-created
persistent branch can conflict.** A PR that touches `supabase/` files can
trigger the branch-limit/cleanup logic in a way that deletes an existing
persistent branch. If you're relying on one deliberate `staging` branch
rather than per-PR previews, turn Automatic Branching off entirely.

**`master` auto-deploys to production on every push (currently by design).**
After merging ANY fix to `master`, immediately sync `staging` to match in the
same sitting — don't treat it as a later step:
```
git checkout staging
git pull origin staging
git merge master --no-edit
git push origin staging
```
Do not trust "Already up to date" from this merge without checking — if your
local `master` was stale (you didn't `git pull origin master` first), the
merge will report "up to date" against your *stale* local copy while
`origin/master` and `origin/staging` are actually still out of sync. Verify
by checking the actual file content/bytes after merging, not just the git
output.

**PowerShell's `Set-Content -Encoding utf8` adds a UTF-8 BOM**, which breaks
`psql` with `syntax error at or near "﻿"` on the first line of the file. This
has caused a migration to fail twice. Never trust a `.sql` file saved this
way without checking. Verify before committing:
```powershell
[System.IO.File]::ReadAllBytes("path\to\file.sql")[0..2] | ForEach-Object { "{0:X2}" -f $_ }
```
Should print `2D 2D ..` (starts with `--`) or the first real character —
never `EF BB BF`. To write a `.sql` file from PowerShell without a BOM:
```powershell
[System.IO.File]::WriteAllText($path, $content, [System.Text.UTF8Encoding]::new($false))
```

**Always confirm which branch is actually checked out before committing.**
`git commit` silently lands on whatever branch is currently checked out, not
the one you intend — this has caused fixes to land on the wrong branch
multiple times in a single session. Run `git branch --show-current` before
`git add`/`commit` if there's any doubt, and check `git status`/`git log
--oneline -3` after any merge or push that seems to do less than expected.

**Vercel's `staging`-scoped env vars must be re-verified every time the
Supabase `staging` branch is recreated.** Its project ref changes on every
recreation (three different refs in one session). `NEXT_PUBLIC_*` values are
baked into the JS bundle at build time, so a stale ref means the app silently
points at a deleted project until a fresh deployment picks up the new value —
check `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY` against the branch's actual current `Settings →
API` values, don't assume they carried over.


`supabase/migrations_old/` is a historical archive from a baseline reset.
Never copy files from it back into `supabase/migrations/` — those changes are
already captured in `00000000000000_baseline.sql`. If unsure whether
something needs a new migration, check the current schema first
(`supabase migration list`), don't restore old files.

**A single baseline dump is not automatically complete.** `public` + `private`
missed a trigger on `auth.users` and an entire extension (`pgmq`) on the first
pass, because `pg_dump` doesn't capture triggers attached to tables outside
the dumped schemas, and it excludes extension-owned objects by design (assumes
`CREATE EXTENSION`, not a hand-copy). When adding a new baseline or schema
capture, check for: triggers on `auth.*` tables, installed extensions
(`select extname from pg_extension`), and privileges that differ from what
`ALTER DEFAULT PRIVILEGES` would produce by default.

For any schema change:
1. Write a new file in `supabase/migrations/`
2. Stop and wait for review — do not run `supabase db push` yourself
3. After a schema change is approved and pushed, regenerate types:
   `npm run types` (currently points at the production project ID directly —
   be explicit about which environment you're generating from once staging's
   schema might diverge)

## Conventions
- Filter state lives in URL search params, never client state. One `<FilterBar>`.
- Week starts **Monday** (still the unit for the 8-week trend chart). Goals
  and the Dashboard/Activity Logs period filter use a **10-day cycle**
  instead (day 1-10 / 11-20 / 21-end-of-month, the last chunk 8-11 days
  depending on the month) — P16/P17. All week/cycle math in `lib/dates.ts`.
  Never inline.
- Money: integer cents in DB, formatted at the edge.
- DB types are generated: `npm run types` → `types/database.ts`. Never hand-edit.
- Enums live in Postgres; TS unions derive from generated types.
- Files: `kebab-case.tsx`. Components: `PascalCase`. Hooks: `use-*.ts`.

## Docs — read on demand, not by default
All of these live under `.github/Spec Sheets/`, not `docs/` — fix any stale
reference you see pointing at `docs/*.md`.

| Need | File |
|---|---|
| Scope, roles, user stories | `.github/Spec Sheets/01-requirements.md` |
| Schema, RLS, RPCs | `.github/Spec Sheets/02-data-model.md` |
| Visual direction, tokens, routes | `.github/Spec Sheets/03-ui.md` |
| Rendered reference for all screens | `.github/Spec Sheets/ui-mockup.html` — **stale, still shows the old dark theme; the live app is the light navy/gold theme in `03-ui.md`. Regenerate before relying on it.** |
| Per-page KPIs, filters, charts | `.github/Spec Sheets/08-screen-specs.md` |
| Auth, profile, settings, app shell | `.github/Spec Sheets/09-account-and-auth.md` |
| User journeys and empty states | `.github/Spec Sheets/10-journeys.md` |
| Security checklist | `.github/Spec Sheets/04-security.md` |
| Test plan | `.github/Spec Sheets/05-testing.md` |
| Build order | `.github/Spec Sheets/06-build-phases.md` |
| Unresolved decisions | `.github/Spec Sheets/00-open-questions.md` |
| Claude Code kickoff prompts | `.github/Spec Sheets/07-getting-started.md` |
| Incident response | `.github/Spec Sheets/11-incident-response.md` |

## Commands
`npm run dev` · `npm test` (vitest — now blocking in CI, no more
`continue-on-error`) · `npm run e2e` (playwright — config exists, no specs
written yet, see `05-testing.md` and `TODOS.md`) · `npm run test:rls` (pgTAP —
all 5 suites currently green) · `npm run types` · `supabase db reset`

## Definition of done (every phase)
Types regenerate clean · vitest green · pgTAP green · `supabase db lint` clean
· no new `NEXT_PUBLIC_` secrets · phase entry in
`.github/Spec Sheets/06-build-phases.md` ticked.