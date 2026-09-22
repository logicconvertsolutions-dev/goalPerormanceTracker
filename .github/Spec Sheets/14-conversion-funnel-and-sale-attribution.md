# 14 — Conversion funnel and sale attribution

**Status:** requirements, not built. Raised 2026-09-22 out of the P26–P28
notification work. Needs product review before any code.

**Owner decision needed on:** §6 open questions. Everything else is settled
enough to build once those are answered.

---

## 1. Why this exists

The SMD cycle digest (P26 era) shipped a three-stage funnel:

```
Calls -> appt set     16%
Set   -> held         20%
Held  -> sale        300%      <-- not a typo
```

That third number is not a conversion rate. It divides **every** sale by
**held appointments only**, and those are different populations: 9 of the 10
sales in production have no appointment attached at all. The 300% is what the
mismatch looks like when it is obvious. The dangerous case is when it is not —
of the three digests delivered on 2026-09-21:

| Leader | Held | Sales | Email printed |
|---|---|---|---|
| Srinath | 1 | 3 | `3/1` — odd enough to question |
| Manmeet | 2 | 1 | **`50%`** — looks entirely plausible |
| Bhupinder | 1 | 0 | **`0%`** — looks plausible and alarming |

Bhupinder's is the one that costs something. "Held → sale: 0%" reads as *nobody
on your team is closing*. The reality is his team held **one** appointment in
ten days. An SMD acting on that coaches closing technique when the actual
problem is that nobody is booking.

There is also a prior art conflict. `conversionFunnel()` in
`src/lib/metrics.ts` already carries:

> *Dashboard B82-B85: every stage is a share of calls made (B82=C10), **not
> chained stage-over-previous-stage**.*

So the dashboard funnel chart shows share-of-calls, and the digest showed a
chained funnel. Two different funnels for the same team, in two places, with
no note that they differ.

**Product direction (2026-09-22):** the chained funnel is the right mental
model — calls become appointments, appointments get held, held appointments
become sales is how the business actually works and how an SMD thinks. So
rather than retreat to share-of-calls, make the chain true.

## 2. Current state, measured

Production, org-wide, all time (2026-09-22):

```
292 calls
 ├─  24 call logs with outcome = 'appointment_set'
 └─  14 appointments actually exist          <-- see §6.3, these disagree
      └─  8 held
          └─  1 produced a linked sale       <-- the only true held->sale datum
 
  +  9 sales with no appointment at all      <-- 90% of sales, outside the funnel
```

`sales.appointment_id` exists and is nullable. `appointmentId` is an optional
input to the sale server action, populated when a sale is logged *from* an
appointment (the appointment form's sale toggle) and left null otherwise.
Standalone sales dominate: Srinath's three from Sep 11-20 were all travel
insurance at $15, $44 and $20, none with an appointment. That is legitimate
business, not sloppy logging — quick closes genuinely happen without booking.

So the chain is real for **calls → set → held** and breaks at the last hop,
partly because some sales genuinely have no appointment and partly because the
link is under-used even when one exists. Today's data cannot distinguish those
two causes.

## 3. What to build

### 3.1 Measure the last hop as a cohort

Of appointments **held in the window**, how many produced a linked sale. Same
population, properly nested, a real conversion rate.

Not: sales-in-window / held-in-window, which is what shipped.

### 3.2 Report out-of-funnel sales as their own line

Sales with no `appointment_id` are not noise to be hidden — for this business
they are most of the revenue. The digest should say so:

> 1 of 8 held appointments produced a sale. 9 other sales came in without an
> appointment.

This is arguably the most useful thing the digest can currently tell an SMD:
*most of your revenue is not coming from booked appointments.* It is invisible
today.

### 3.3 Make the link the default where one plausibly exists

The rate will read low until logging improves, and a metric that mostly
measures logging habit is a weak metric. In the sale form, when the selected
contact has a recent held appointment, pre-select it as the linked appointment
with an explicit opt-out. Do not force it — genuine no-appointment sales must
stay one click.

### 3.4 Reconcile the two funnels

Either the dashboard funnel chart adopts the chained model, or both surfaces
state plainly which model they use. Two different funnels for the same team
with no explanation is worse than either one alone. `conversionFunnel()`'s
comment must be updated or the function changed — it currently documents a
decision this work reverses.

## 4. Data model / API

The cohort join needs `appointments` joined to `sales`. Both are **raw
activity tables**, so:

- CLAUDE.md rule 10 — dashboards read `daily_metrics`, never raw activity
  tables. A direct read in `compose.ts` (the trick used for
  `recruiting_convos` / `sales_count`, which are `daily_metrics` columns and
  therefore fine) is **not** available here.
- CLAUDE.md rule 2 — team data reaches leaders only via `SECURITY DEFINER`
  RPCs returning counts/sums.

So this needs **a new `SECURITY DEFINER` RPC** returning counts only, e.g.
`private.team_funnel_for(p_leader_id, p_from, p_to)` plus a
`system_team_funnel` twin for the service-role cron path (mirroring the
existing `team_period_summary` / `system_team_period_summary` pair):

| Column | Meaning |
|---|---|
| `appts_held` | appointments with `status='held'`, `appt_date` in window |
| `appts_held_with_sale` | ...of those, how many have a linked sale |
| `sales_unlinked` | sales in window with `appointment_id is null` |
| `sales_linked` | sales in window with a linked appointment |

Counts only. No `contact_name`, no `notes`, no `client_name` crosses the
hierarchy boundary. `set search_path = ''`, fully-qualified names, `private`
schema with a `public` wrapper, and `REVOKE ... FROM PUBLIC, anon,
authenticated` by name (rule 4).

Build the function body from `pg_get_functiondef()` of anything it replaces,
never from `00000000000000_baseline.sql` — see P26, where a body taken from
the stale baseline dropped a column a later migration had added and Postgres
rejected the whole migration.

## 5. Acceptance criteria

1. The digest's third funnel cell is a cohort rate: held appointments in the
   window that produced a linked sale, over held appointments in the window.
   It cannot exceed 100%.
2. Out-of-funnel sales appear as their own stated figure, not folded into any
   rate.
3. No screen or email shows a percentage whose numerator and denominator come
   from different populations.
4. Dashboard and digest either use the same funnel model, or each states which
   it uses.
5. The new RPC returns counts only and is covered by the pgTAP RLS suite —
   specifically that a leader cannot reach another org's counts, and that
   `anon`/`authenticated` cannot execute the service-role twin.
6. Unit tests pin each rate's denominator. The absence of such a test is why
   the 300% shipped.
7. Sale form pre-selects a plausible appointment and still allows a
   no-appointment sale in one click.

## 6. Open questions

**6.1 Is the low linked rate a logging problem or a business fact?**
1 of 8 could mean agents do not link, or that held appointments genuinely
rarely convert. Today's data cannot tell them apart. §3.3 is the intervention
that would separate them over a cycle or two — worth shipping §3.1/§3.2 first
and re-reading the number after.

**6.2 Should the digest show a rate at all while n is this small?**
Bhupinder's "0%" came from a denominator of 1. Consider suppressing the rate
below a minimum denominator (say 5 held appointments) and showing the raw
counts instead. Cheap, and removes the whole class of noise-as-KPI.

**6.3 Calls claiming `appointment_set` (24) outnumber appointments (14).**
These should roughly agree since P23/P25 made a call create an appointment.
Either pre-P23 history, or a third counting mismatch. **Not investigated** —
needs its own look before `calls → set` is trusted as precisely as §3 assumes.

**6.4 `appts_set` and `appt_held` are bucketed on different dates.**
`appts_set` by booking day (`created_at` in the agent's zone), `appt_held` by
`appt_date`. An appointment booked day 9 for day 13 is *set* in this cycle and
*held* in the next, so `set → held` systematically under-reports at every cycle
boundary. Smaller than the held→sale problem and directionally still useful,
but it means the middle hop is not exact either. Decide whether to cohort this
hop too (track appointments *set* in the window through to their held status,
whenever that lands) or accept the boundary effect and document it.

## 7. Out of scope

- Changing how `daily_metrics` counts anything. Rule 12 stands: an event count
  is never a filter on current state.
- Backfilling `appointment_id` on historical sales. There is no reliable way to
  infer which of the 9 unlinked sales came from an appointment, and guessing
  would manufacture data.
- The `/team` roster table and CSV export, which do not show conversion rates.
