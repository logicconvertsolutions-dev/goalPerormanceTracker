# Screen specs — KPIs, filters, charts

Companion to `docs/03-ui.md` (tokens, routes, the two hero screens). This file
specifies what goes *on* each page.

---

## Shared: the filter pattern

Build **one** `<FilterBar>` primitive and reuse it everywhere. Filter state lives
in **URL search params**, not React state:

`/sales?from=2026-08-01&to=2026-08-31&product=term,ul&sort=premium.desc`

Why: Server Components re-render off `searchParams` with no client state
library, every view is bookmarkable and shareable, back/forward works, and an
SMD can paste "here's the week I'm talking about" into a message. Client state
would cost you all four.

Rules:
- Period presets on every page: **This Week · Last Week · This Month · Last 30 Days · Custom**. Week = Monday start, always.
- Default period is This Week. Default sort is date descending.
- Active filters render as removable chips under the bar, plus a **Clear all**.
- Empty result reads "No sales between 1–31 Aug with these filters" and offers
  Clear all — never a bare "No data".
- Mobile: the bar collapses to a single **Filters** button opening a Sheet, with
  a count badge for active filters.

## Shared: the KPI card

`label · value (large, mono, tabular) · secondary line`
Secondary line is either `/ target` with a thin progress bar, or a
period-over-period delta (`▲ 12 vs last week`). Attainment colour only —
green ≥100%, amber 70–99%, red <70%. A card with no target shows no colour.

## On pie charts — read before building

You asked for pie charts. Use them for **two or three** slices only. A pie with
six near-equal slices is unreadable: humans compare angles badly, and your Source
breakdown has six categories that will often sit within a few percent of each
other. Specified below:

- **Donut** for Call Outcomes (5) and Appointment Status (5) — with the centre
  showing the total, which is where a pie's wasted space earns its keep.
- **Horizontal bar, sorted descending** for Call Source (6) — this one is a
  ranking question ("where are my leads actually coming from"), and bars answer
  ranking questions correctly.

Swap either for a pie in ten minutes if you disagree after seeing it. Don't
argue about it before the pilot; ask the SMDs.

---

## `/dashboard` — agent dashboard

Port of the workbook's Dashboard tab.

**Filters:** period presets + custom range.

**KPI row 1** — Calls Made `n / target` · Appointments Held `n / target` ·
Premium `$n / target` · Current Streak (days) · Days to MD Deadline

**KPI row 2** — Dial-to-Connect Rate · No-Show Rate · Referrals Given ·
Recruiting Conversations · Pipeline Value (open appointments)

**Charts**
| Chart | Type | Data |
|---|---|---|
| Call Outcomes | donut, total in centre | connected / voicemail / no answer / appt set / not interested |
| Appointment Status | donut | scheduled / held / no-show / rescheduled / cancelled |
| Call Source | horizontal bar, sorted | warm market / referral / cold / social / friend / other |
| 8-Week Trend | bars = calls, line = calls target; toggle to premium | last 8 weeks ending in selected week |
| Conversion Funnel | horizontal stepped bars | calls → appts set → appts held → sales, with the conversion % printed between stages |

The funnel percentages are the point of the funnel. `7 → 2 → 0 → 0` tells you
nothing; `7 → 2 (29%) → 0 (0%)` tells you where the week broke.

Layout: KPIs full width, then charts 2-up on desktop, stacked on mobile.
Every chart has a table fallback for screen readers.

---

## `/today` — the callback queue

**The screen an associate opens first.** No filters, no charts, no configuration.

- Header: `4 due today · 2 overdue` and today's call counter against the minimum
- **Overdue** section first, oldest at top, each row muted-red
- **Due today** below it
- Row: contact name · what they said last time (the note, truncated) · how many
  times called · how long since the last call
- Tap a row → `/log` pre-filled with that contact and their history visible
- Swipe or menu per row: **Snooze 1 day · Snooze 1 week · Mark done**
- Below the queue: "Nothing else due. Log a new call →"

Empty state: "Nothing due today. Set a follow-up when you log a call and it'll
show up here." — teaches the mechanic rather than reporting a void.

## `/contacts` — contact list

One row per **person**, not per call — this is the screen an agent uses to
remember someone from six weeks ago.

**Filters:** last-contacted range · source · last outcome · has open follow-up ·
text search on name and company · sort.
**Summary strip:** contacts · called this month · never followed up · open follow-ups.
**Table:** Contact · Company · Times called · Last called · Last outcome ·
Next follow-up.
Tap → contact detail: full call history for that person, their appointments,
their sale if any, and a Log a call button.
CSV export of the filtered set.

## `/appointments`

**Filters:** date range · status (multi) · type · search.
**Summary strip:** scheduled · held · no-show rate · total expected premium of
open appointments.
**Table:** Date · Contact · Type · Status · Expected Premium · Referrals Given ·
Notes. Marking an appointment `held` prompts once: "Did this produce a sale?" —
Yes opens the sale form pre-filled, No records the outcome. Without that prompt
the sales log stays empty and the funnel's last stage is permanently zero. Status is inline-editable via a dropdown — changing `scheduled` → `held`
is the most frequent action in the whole app, so it must not require opening a
detail page.

## `/sales`

**Filters:** date range · product type (multi) · premium min/max · search on
client name · sort by date or premium.
**Summary strip:** number of sales · total premium · average premium · largest sale.
**Table:** Date · Client · Product Type · Premium · Notes.
Sticky totals row at the bottom reflecting **the filtered set**, not all time.
CSV export.

## `/recruiting`

**Filters:** date range · status (multi) · source.
**Summary strip:** conversations · interviewed · joined · licensed.
**Table:** Date · Prospect · Source · Status · Notes. Status inline-editable.

---

## `/team` — SMD dashboard

**Filter bar**
- Period presets + custom range
- **Agent selector** — multi-select, default *All agents*; searchable when the
  roster is long
- View toggle: **Summary** (roster) · **Daily** (day-by-day grid)

**Team KPI strip** — Total Calls `n / team target` · Total Appointments Held
`n / target` · Total Premium `$n / target` · Agents On Target `x / N` ·
Quiet Agents (nothing logged in 7 days)

"Quiet agents" is the most actionable number on the page. Make it clickable —
it filters the roster to exactly those people. Each quiet row gets a **Nudge**
button: sends that agent a short email plus a deep link, writes to the audit log,
rate-limited to one per agent per week. Without it the SMD leaves the app to send
a text and the coaching loop happens somewhere you cannot see or measure.

**Summary view** — the roster table from `docs/03-ui.md`, plus:
| Chart | Type |
|---|---|
| Calls by Agent | horizontal bar, sorted descending, target line overlaid |
| Team Call Outcomes | donut |
| Team Call Source | horizontal bar |
| 8-Week Team Trend | bars = calls, line = target |

**Daily view** — a grid, dates down the left, one column per selected agent,
cells showing calls made, with a dot for min-met. Reads as an attendance sheet.
This is the "who is actually working" view; it is what an SMD opens on Monday.

**Filtered to one agent** — the page becomes that agent's dashboard, rendered
from `agent_daily_activity` and the breakdown counts: same KPI rows, same five
charts, same daily grid. **Counts only — no contact name, no client name, no
notes, ever.** The layout is deliberately identical to the agent's own
`/dashboard` so coaching happens against the same picture the agent sees.

CSV export of the roster and of a single agent's daily grid.

---

## States, on every screen
Loading → skeletons matching the final layout (never a full-page spinner).
Empty → names the reason and offers the fix.
Error → what failed and a retry, never a raw stack.
Mobile → tables collapse to cards; donuts stay; wide bar charts scroll horizontally.
