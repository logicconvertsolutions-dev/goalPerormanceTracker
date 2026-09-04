# Requirements

**Entities and user stories below matched the pre-P1 plan; the product has
since shipped through P11 (`docs/06-build-phases.md`) with the schema
described in `docs/02-data-model.md` and the screens in
`docs/08-screen-specs.md`. This file's Objective, Roles, and out-of-scope
list are still accurate; the Entities section has drifted in specific,
callable-out ways — see the inline notes below.**

## Problem
The current tracker is a per-agent Excel workbook (`Call Log`, `Appointment Log`,
`Sales Log`, `Recruiting Log`, `Daily Log`, `Dashboard`). It works for one person
and does not aggregate. An SMD coaching N associates has no view of activity
without collecting N files, and the files are stale the moment they are sent.

## Objective
0. An associate opens the app in the morning and is told **who to call today**.
   This is the reason they open it at all; the metrics are a by-product.
1. An associate logs activity in **under 10 seconds on a phone**.
2. An upline sees every downline agent's activity vs. target, **live**, without
   asking for anything.
3. Prospect identities never leave the agent who owns them.

If (1) fails, nothing else matters — the tool dies of non-adoption, exactly like
the spreadsheet does for everyone except its author.

## Roles

| Role | Scope | Capability |
|---|---|---|
| `associate` | own records | log activity, own dashboard, own targets view |
| `leader` (SMD) | own subtree, own org | everything an associate has, plus team roster, team rollups, filter-by-agent daily/weekly drill-down, invite into own subtree |
| `admin` (you) | all orgs | user lifecycle, audit log, hierarchy repair, org provisioning |

**P11: "all orgs" scope means admin acts *across* every org, not that admin
belongs to one** — `agents.org_id` is now `null` for every admin account
(previously it held whatever org they happened to come from, a leftover
that put them inside that org's own hierarchy). See
`docs/09-account-and-auth.md`'s "Admin is not part of any organization."

Role = capability. Hierarchy position = scope. Organization = hard tenant fence.
Three separate concerns; do not collapse them. Two SMD organizations run on one
database and must never see each other.

Two levels only for now (SMD → associate). No MD tier in v1.

## Entities (mirrors the existing workbook — with the drift noted below)

**Contact** — a person the agent is working: name, **notes** (free text,
added P13, searchable from `/contacts`). Phone went through two full
reversals — added P9 (the original design deliberately omitted phone/email
to keep PIPEDA surface small; reversed once import needed a reliable dedup
key beyond name), made optional post-P12, then **removed outright again in
P13** — a contact's phone number is never collected, shown, or stored
anywhere, and name is the sole dedup key everywhere a contact is created.
`company`, present at launch, was later dropped — no longer collected.
Calls, appointments, sales, and recruiting logs all attach to a contact, so
history accumulates per person rather than scattering across rows —
recruiting and sales now link to `contact_id` rather than storing a
redundant free-text name, which the original design had.

**Call log** — date, contact, source, outcome, notes, **follow-up date**
- source: `warm_market | referral | cold | social_media | friend | other`
- outcome: `connected | voicemail | no_answer | appointment_set | not_interested`

**Appointment log** — date, contact, type, status, expected premium,
referrals given, notes, **follow-up date** (added P9, mirroring call logs)
- status: `scheduled | held | no_show | rescheduled | cancelled`

**Sales log** — date, contact (not a free-text client name — links to
`contacts`/optionally `appointments`), product type, premium amount, notes,
follow-up date

**Recruiting log** — date, contact (not a free-text prospect name), source,
status, notes
- status (**changed P8a**): `contacted | marketing_presented | recruited |
  certified | licensed | declined` — not the original
  `contacted | interviewed | joined | licensed | declined`. Legacy labels
  remap on import for backward compatibility.

**Targets** — **set by the SMD**, mirroring the workbook's gold cells: calls/wk,
appts held/wk, premium/wk, min calls/day (streak threshold), MD deadline date.
An org-wide default plus optional per-agent overrides. Agents see their targets
in settings, read-only. Versioned by `effective_from`, so a past week is always
scored against the target that was live then.

Because the SMD owns the denominator, % to goal is a trustworthy sort key and
the roster can lead with it. Every target change is audit-logged.

## Derived metrics (port from the Dashboard tab — same formulas)
- Calls / appts held / premium: actual vs. target, % to goal
- Call outcome breakdown, appointment status breakdown, source breakdown
- 8-week trend: calls, calls target, appts held, premium, premium target
- Dial-to-connect ratio · no-show rate · referrals given · recruiting
  conversations · new associates licensed (all-time) · open-appointment pipeline
  value · current calling streak · 4-week rolling average calls/wk · days to
  MD deadline
- Conversion funnel: calls → appts set → appts held → sales closed

## User stories

**Associate**
- See who I owe a callback today, with what was said last time
- Set "call back in a month" while logging, in one tap, and trust it will
  resurface
- Log yesterday's calls tonight without fighting a date picker
- Log a call in one screen without leaving the dialer flow
- See today's count against my daily minimum, and my streak
- See this week vs. the target my SMD set for me, and the 8-week trend
- Import my existing spreadsheet once, on day 1
- Know that my upline sees my numbers and not my contacts

**Leader (SMD)**
- See a roster of my whole downline: calls, appts set, appts held, premium,
  % to goal, streak, last-logged timestamp — this week and last
- Sort by % to goal so I know who to call today
- Drill into one agent's aggregates and 8-week trend
- Filter the roster to one agent and see their activity day by day and week by
  week over any range
- Set an org-wide default target and override it for individual agents
- Invite a new associate into my organization
- See who has logged nothing in 7 days, and nudge them without leaving the app

**Admin**
- Deactivate an agent without deleting history
- Move an agent to a different upline and have the hierarchy self-heal
- Read an append-only audit log

## Explicitly out of scope (v1)
Billing · e-signature · FNA/KYC forms · carrier integrations · commission
tracking · in-app calling/dialer · client-facing anything. Still true as of
P9 — `/clients` (added since this list was written) is an internal view
derived from an agent's own sales, not a client-facing screen or a new
billing/commission concept; see `docs/08-screen-specs.md`.
