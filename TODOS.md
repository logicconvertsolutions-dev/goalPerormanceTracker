# TODOs

Design debt and deferred work surfaced by review. Newest first.

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
