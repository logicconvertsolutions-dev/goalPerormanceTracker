# TODOs

Design debt and deferred work surfaced by review. Newest first.

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
