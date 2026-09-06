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