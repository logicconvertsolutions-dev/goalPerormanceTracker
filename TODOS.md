# TODOs

Design debt and deferred work surfaced by review. Newest first.

## 2026-09-03 — No pgTAP coverage for P12a's auto-nudge schema; golden-file import test not re-run

**What:** `20260903165109_p12a_auto_call_nudges.sql` added
`agents.auto_call_nudges_enabled`, the `agent_auto_nudge_log` table, and the
`set_auto_call_nudges`/`team_inactive` RPCs (the latter recreated with a new
return column) — none of it has pgTAP coverage, same gap as the P11 entry
below. Separately, `src/lib/import/commit-import.ts` was substantially
rewritten this pass (bulk contact resolution + chunked activity-table
inserts, replacing a fully sequential per-row loop) to fix large workbook
imports timing out, and the only integration test that exercises it against
a real database — `src/lib/import/__tests__/golden-file.test.tsx`
(`describe.skipIf(!canRun)`) — requires a local Supabase instance
(`supabase start`) this session didn't have running, so it was skipped, not
re-verified against the rewrite. New unit coverage was added instead
(`src/lib/import/commit-import.test.ts`, an in-memory fake Supabase client)
covering the specific behaviors the rewrite changed — cross-sheet contact
consolidation, idempotent re-import, name-first dedup — but that's not a
substitute for the golden-file test's real assertion: that the imported
`daily_metrics` numbers match the workbook's own Dashboard-tab formulas
exactly.

**Why deferred:** pgTAP tests are separate, non-trivial work (same reasoning
as the P11 entry). The golden-file test needs a running local Supabase
stack, unavailable in this session's sandbox.

**Impact:** a future migration could silently weaken the new
`auto_call_nudges_enabled`/`agent_auto_nudge_log` shape and nothing would
catch it. More importantly, run `npx vitest run src/lib/import/__tests__/golden-file.test.tsx`
against a local Supabase instance before the next deploy that touches
imports — the unit tests give confidence in the new logic in isolation, but
the golden-file test is what actually proves the rewritten commit path
produces the same real numbers as before.

**Depends on / blocked by:** nothing technical for the pgTAP half (same
shape as existing tests). The golden-file half just needs `supabase start`
run once, locally or in CI, with `NEXT_PUBLIC_SUPABASE_URL` /
`SUPABASE_SERVICE_ROLE_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` set.

## 2026-08-31 — Email deliverability (spam folder) needs DNS/dashboard config, not just code

**What:** Reported: outbound mail (magic-link, password reset, notifications)
sometimes lands in spam. Two code-level fixes landed alongside this note
(`src/app/auth/callback/route.ts` for the PKCE code-exchange bug that made
magic-link/reset-password emails look broken, and `List-Unsubscribe` /
`List-Unsubscribe-Post` headers on the three recurring notification emails
in `src/lib/notifications/{templates,send}.ts`), but the rest of inbox
placement is DNS/dashboard configuration this session has no access to:

1. **Verify the sending domain in Resend** (`resend.com` → Domains) rather
   than sending from a shared/default domain. `NOTIFICATIONS_FROM_EMAIL`
   must be `Team Tracker <notifications@your-verified-domain>`.
2. **Add the SPF, DKIM, and DMARC DNS records** Resend's domain page
   generates, at the registrar for that sending domain. Missing DKIM in
   particular is the single biggest cause of Gmail/Outlook spam
   classification.
3. **Point Supabase Auth's SMTP at the same verified domain** (Dashboard →
   Authentication → Emails → SMTP Settings — the commented-out block in
   `supabase/config.toml:236-246` documents the Resend SMTP host/port for
   local parity). Auth emails (magic link, password recovery) currently go
   out through whatever the hosted project's SMTP is configured to; if it's
   still Supabase's shared default sender, that's a separate deliverability
   gap from the notification emails above and explains "sometimes" rather
   than "always" landing in spam if only one of the two is misconfigured.
4. **Add a DMARC record** (`_dmarc.your-domain`) once SPF/DKIM pass
   consistently — start at `p=none` to monitor, tighten later.

**Why deferred:** all four steps require DNS registrar access and the
Resend/Supabase dashboards, which this session doesn't have. No further
code change unlocks this — it's an infra checklist for whoever holds those
accounts.

**Impact:** until done, inbox placement stays inconsistent regardless of
any further app code changes.

## 2026-08-31 — No pgTAP coverage for P11's admin/org-detachment schema changes

**What:** `p11c_admin_no_org.sql` added two check constraints
(`agents_org_required_unless_admin`, `agents_admin_no_upline`) plus a third
on `invitations`, and `p11b_agent_email_change.sql` added
`agent_email_changes` with no RLS policies at all (service-role only).
None of this has pgTAP coverage — `supabase/tests/*.sql` still only covers
the P1-era RLS/hierarchy shape, the `daily_metrics` pipeline, notifications,
and pilot instrumentation.

**Why deferred:** this pass was a documentation sync (`.github/Spec
Sheets/*.md` brought up to date with the P11 migrations and app changes
already shipped), not a testing pass — writing pgTAP tests is separate,
non-trivial work (seeding an admin row, asserting the constraints reject a
non-admin null-`org_id` insert and accept an admin one, asserting
`agent_email_changes` is unreachable from `authenticated`).

**Impact:** a future migration could silently weaken or drop either check
constraint and nothing would catch it before it reached production.

**Depends on / blocked by:** nothing technical — same shape as the existing
RLS/hierarchy tests in `supabase/tests/001_rls_and_hierarchy.sql`, just
scoped to the new constraints and table.

## 2026-08-27 — Playwright E2E suite was never built

**What:** `playwright.config.ts` is configured and CI has a `playwright` job
that runs `npm run e2e`, but there is no `e2e/` directory and no `.spec.ts`
file anywhere in the repo. None of the 10 scenarios in
`.github/Spec Sheets/05-testing.md` §4 exist — including the login→log→
roster flow, the offline-persistence test, and the follow-up-loop test that
exercises the product's core mechanic end-to-end.

**Why surfaced now:** found during a `/document-release` pass syncing the
Spec Sheets to the live codebase (2026-08-27) — `05-testing.md` described
this suite as built; it isn't. Not filed as a bug since nothing is broken,
but the CI `playwright` job currently passes trivially (zero tests to run)
rather than gating anything, which is worth knowing before trusting that
green check.

**Why deferred:** genuine scope, not a quick fix — building even the first
scenario (invite → signup → log → appears on `/team`, calling the metrics
drain RPC directly per the spec's own flakiness warning) means standing up
Playwright fixtures against a real Supabase instance. Not something to fold
into an unrelated change.

**Depends on / blocked by:** nothing technical — the spec (`05-testing.md`
§4) already has the scenario list written out. This is pure unstarted build
work, not a design decision waiting on input.

## 2026-08-27 — Activity Logs tab URL query param lags one click behind

**What:** On `/logs`, the `?type=` query param always reflects the
*previously* selected tab, not the one just clicked (e.g. clicking
"Sales" navigates to `?type=appointment`). The UI itself is always
correct — right tab highlighted, right table/empty-state shown — only
the URL is one step stale.

**Why deferred:** Low severity (ISSUE-005 from `/qa`,
`.gstack/qa-reports/qa-report-localhost-2026-08-27.md`) — cosmetic
URL-state bug, not a functional break. Standard tier fixes
critical/high/medium; low severity is deferred by default.

**Impact:** Breaks bookmarking/sharing a specific tab's URL and could
cause a mismatch on browser back/forward. No data-correctness or
visible-UI impact.

## 2026-08-26 — Regenerate ui-mockup.html for the light theme

**What:** Regenerate `.github/Spec Sheets/ui-mockup.html` to match the light
theme in `docs/03-ui.md` (white ground, navy accent, gold reserved for brand
mark/"filed" status, Plus Jakarta Sans, 10–28px radii, floating card shadows).

**Why:** It still renders the retired dark theme (`#08090A` ground, `#3D9AFF`
accent) — confirmed 8 references to the old palette still present. It's the
file CLAUDE.md calls "the rendered reference for all screens," so anyone who
opens it expecting the current UI gets an actively wrong picture.

**Pros:** Restores a trustworthy single-file visual reference for every screen
— useful for onboarding a new contributor or checking a screen's intended
layout without running the app.

**Cons:** Meaningful, standalone effort — regenerating a full static mockup
for every screen isn't a small edit. Best scoped as its own pass rather than
folded into unrelated work.

**Context:** `docs/03-ui.md` itself was rewritten in this review
(`/plan-design-review`, 2026-08-26) to match the live theme — the mockup
regeneration is the natural follow-up now that the token reference is
accurate. CLAUDE.md's doc-pointer table already flags the mockup as stale
inline so nobody trusts it by accident in the meantime.

**Depends on / blocked by:** `docs/03-ui.md` rewrite (done). Best done via
`/design-html`, which generates production-quality HTML from an approved
design direction — the direction here is already locked (the live app), so
this could also just be `/design-html` fed screenshots of the real app rather
than a fresh mockup exploration.
