# Open questions — status

**As of 2026-08-27:** the product has shipped through P9 (see
`docs/06-build-phases.md`) and `/admin/pilot` exists to instrument the P7
pilot's daily-active-loggers question. That's tooling readiness, not an
answer to the blocking questions below — items 6–8 are business/legal
decisions outside what the code can resolve, and remain open until Deepak
confirms otherwise.

## Resolved (2026-08-13)

1. **Sponsorship** — two SMDs ready to invest. This is a product with customers,
   not a personal tool. Consequences: hard multi-tenant isolation between the two
   organizations, and a real compliance posture (see #2 below).
2. **PII** — uplines never see prospect names. Confirmed. SMD gets filter-by-agent
   and per-day / per-week activity, counts only.
3. **Hierarchy** — two levels for now (SMD → associates). Closure table stays
   anyway; see the note in `02-data-model.md`.
4. **Targets** — set by the SMD: org-wide default plus per-agent overrides.
   Agents view read-only.
5. **Scale** — build for 200 agents; architecture must not block growth.
   `daily_metrics` read model + dirty-queue recompute from P1. Partitioning
   deferred to >2,000 agents. Full numbers in `02-data-model.md`.

## Blocking

6. **What does "invest" mean concretely?** Money up front, a paid pilot, a
   revenue share, or enthusiasm? Get it in writing before P1. Two SMDs saying yes
   in a conversation is not two customers — a signed pilot agreement with a start
   date and a number is. This is the single highest-value thing to nail down this
   week, and it costs no code.

7. **Compliance sign-off.** With paying SMDs, prospect activity data for their
   downlines sits in your system. Does either SMD's compliance obligation to WFG
   require disclosure or approval of a third-party tool? Ask them directly, get
   the answer in email. This is the exact failure mode that killed FinComply's
   positioning — a platform-adjacent product with an unresolved compliance
   relationship. Resolve it before writing schema, not after signing users.

8. **Data ownership on exit.** If an SMD leaves, who owns the activity history —
   the SMD, each associate, or you? Put it in the pilot agreement. Associates'
   prospect data should follow the associate.

## Non-blocking

9. Leaderboard across associates within one org — opt in, first names only?
10. Does the SMD need CSV/PDF export for their own upline reporting?
11. Pricing model — per seat per month, or flat per team? Not needed until P6.
12. Mobile web PWA assumed. Confirm no native app expectation.
