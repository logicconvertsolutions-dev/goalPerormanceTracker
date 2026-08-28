# Goal Performance Tracker

Multi-tenant callback queue and activity tracker for WFG teams. An associate
opens it to see **who to call today**; the metrics are a by-product. They log
calls, appointments, sales, and recruiting conversations against **contacts**
(people, not rows). Their SMD sees **aggregate** performance — per day, per
week, filterable to one agent — and never prospect PII. Two customer
organizations share one database and never see each other's data.

Full product spec, data model, security model, and screen-by-screen detail
live in [`.github/Spec Sheets/`](.github/Spec%20Sheets/) — start with
[`CLAUDE.md`](.github/Spec%20Sheets/CLAUDE.md) there for the doc index and
the non-negotiable engineering rules. This file is just enough to get the
app running locally.

## Stack

Next.js 15 (App Router) · TypeScript (strict) · Supabase (Auth + Postgres +
RLS) · Tailwind + shadcn/ui · Recharts · Zod · Vercel.

## Getting started

Prerequisites: Node 18 or 20, the [Supabase CLI](https://supabase.com/docs/guides/cli), Docker (for the local Supabase stack).

```bash
npm install
supabase start          # local Postgres + Auth, per supabase/config.toml
supabase db reset       # applies every migration in supabase/migrations
npm run types           # regenerates types/database.ts from the schema
npm run dev             # http://localhost:3000
```

Copy `.env.example` to `.env.local` and fill in the values `supabase start`
prints out (API URL, anon key) plus anything else listed there. Never put
`SUPABASE_SERVICE_ROLE_KEY` in a `NEXT_PUBLIC_*` variable — CI has a grep
gate that fails the build if it leaks into the client bundle.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` / `npm run start` | Production build / run |
| `npm run type-check` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Vitest unit tests |
| `npm run test:rls` | pgTAP suite against a local Supabase instance (`supabase test db`) |
| `npm run e2e` | Playwright — configured, but no specs exist yet (see `TODOS.md`) |
| `npm run types` | Regenerate `types/database.ts` from the live schema — never hand-edit that file |

## Where things live

- **Product spec, data model, screens, security, journeys** —
  [`.github/Spec Sheets/`](.github/Spec%20Sheets/), see its `CLAUDE.md` for
  the full index.
- **Database** — `supabase/migrations/` (schema, RLS, RPCs, chronological)
  and `supabase/tests/` (pgTAP).
- **App routes** — `src/app/(auth)/**` (login, invites, password reset),
  `src/app/(app)/**` (everything behind a session).
- **Known deferred work** — [`TODOS.md`](TODOS.md).

## CI

`.github/workflows/ci.yml` runs the service-role-key leak gate, type-check,
lint, build, vitest, `supabase db lint`, and the pgTAP suite on every push
and PR to `master`/`dev`. See `.github/Spec Sheets/05-testing.md` for which
of these actually block a merge today versus just report.
