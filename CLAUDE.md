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