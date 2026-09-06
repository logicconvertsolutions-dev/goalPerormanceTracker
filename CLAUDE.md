# Kautis — Project Guidance

## What this is
Full SaaS app with user accounts and a dashboard.
Stack: GitHub (this repo) → Vercel (production hosting) → Supabase Pro (Postgres, Auth, RLS) → Resend (transactional email).

## Environments
- `master` → production
- `staging` → sandbox (isolated Supabase branch, staging.kautis.com)

## Database changes — mandatory workflow
Never modify the Supabase schema or data directly — `apply_migration` and `execute_sql`
are blocked in .claude/settings.json for this reason. For any schema change:
1. Write a new file in `supabase/migrations/`
2. Stop and wait for review — do not run `supabase db push` yourself

## Conventions
[fill in: framework, folder layout, lint/test commands, naming conventions]

## Testing
[link to or paste the testing plan: functional, regression, RLS/security, load, manual pentest]

## Database changes — mandatory workflow
Never modify the Supabase schema or data directly. `apply_migration` and `execute_sql`
MCP tools are blocked in `.claude/settings.json` — this is enforced, not just requested.

`supabase/migrations_old/` is a historical archive from a baseline reset. Never copy
files from it back into `supabase/migrations/` — those changes are already captured
in `00000000000000_baseline.sql`. If you're unsure whether something needs a new
migration, check the current schema first (`supabase migration list`), don't restore
old files.

For any schema change:
1. Write a new file in `supabase/migrations/`
2. Stop and wait for review — do not run `supabase db push` yourself
3. After a schema change is approved and pushed, regenerate types: `npm run types`