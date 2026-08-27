# WFG Team Tracker — Claude Code project memory

Multi-tenant callback queue and activity tracker for WFG teams. An associate
opens it to see **who to call today**; the metrics are a by-product. They log
calls / appointments / sales against **contacts** (people, not rows). Their SMD sees **aggregate** performance — per day, per
week, filterable to one agent — and never prospect PII.
Two customer organizations share one database; they must never see each other.

## Stack (locked — do not re-litigate)
Next.js 14 App Router · TypeScript strict · Supabase (Auth + Postgres + RLS)
· Tailwind + shadcn/ui · Recharts · Zod · Vercel
**Light theme only** (see `docs/03-ui.md` — supersedes an earlier dark-theme
direction shipped through P0–P2). No second theme, no theme toggle in v1.

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
4. Service-role key is server-only. Never in a `NEXT_PUBLIC_` var, never in a
   client component, never in an artifact.
5. Server Components by default. `'use client'` only for interactivity.
6. All mutations are Server Actions with Zod input validation.
7. **Every table carries `org_id`; every policy and RPC checks it**, on top of
   the hierarchy check. Two independent fences.
8. Targets are set by the SMD (org default + per-agent override), versioned by
   `effective_from`. Never mutate a past target row. Resolve them only through
   `private.effective_target()`.
9. **Dashboards read `daily_metrics`, never raw activity tables.** The only
   exception is an agent's own numbers for today. If you find yourself
   aggregating `call_logs` in a dashboard query, stop — you are bypassing the
   read model.
10. No new dependency without asking.

## Conventions
- Filter state lives in URL search params, never client state. One `<FilterBar>`.
- Week starts **Monday**. All week math in `lib/dates.ts`. Never inline.
- Money: integer cents in DB, formatted at the edge.
- DB types are generated: `npm run types` → `types/database.ts`. Never hand-edit.
- Enums live in Postgres; TS unions derive from generated types.
- Files: `kebab-case.tsx`. Components: `PascalCase`. Hooks: `use-*.ts`.

## Docs — read on demand, not by default
| Need | File |
|---|---|
| Scope, roles, user stories | `docs/01-requirements.md` |
| Schema, RLS, RPCs | `docs/02-data-model.md` |
| Visual direction, tokens, routes | `docs/03-ui.md` |
| Rendered reference for all screens | `ui-mockup.html` (repo root) — **stale, still shows the old dark theme; the live app is the light navy/gold theme in `docs/03-ui.md`. Regenerate before relying on it.** |
| Per-page KPIs, filters, charts | `docs/08-screen-specs.md` |
| Auth, profile, settings, app shell | `docs/09-account-and-auth.md` |
| User journeys and empty states | `docs/10-journeys.md` |
| Security checklist | `docs/04-security.md` |
| Test plan | `docs/05-testing.md` |
| Build order | `docs/06-build-phases.md` |
| Unresolved decisions | `docs/00-open-questions.md` |
| Claude Code kickoff prompts | `docs/07-getting-started.md` |

## Commands
`npm run dev` · `npm run test` (vitest) · `npm run test:e2e` (playwright)
· `npm run test:rls` (pgTAP) · `npm run types` · `supabase db reset`

## Definition of done (every phase)
Types regenerate clean · vitest green · pgTAP green · `supabase db lint` clean
· no new `NEXT_PUBLIC_` secrets · phase entry in `docs/06-build-phases.md` ticked.
