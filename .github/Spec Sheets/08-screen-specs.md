# Screen specs — KPIs, filters, charts

**Reflects the live app as of 2026-08-31.** The original P1-era version of
this file specified what to build; this version describes what actually got
built, including several screens (`/logs`, `/clients`, `/notes`, all four
`/admin/*` pages) that either didn't exist in the original spec or were only
sketched in one line elsewhere. Companion to `docs/03-ui.md` (tokens, routes,
the two hero screens) and `docs/09-account-and-auth.md` (auth/account/admin
screens covered from the auth angle there; this file covers their content
and layout).

---

## Shared: the filter pattern — confirmed, unchanged

One `<FilterBar>` component, reused verbatim across `/dashboard`,
`/appointments`, `/sales`, `/recruiting`, `/logs`, `/team`,
`/team/[agentId]`, and `/team/[agentId]/daily`. Filter state lives in URL
search params. Period presets: **This Week · Last Week · This Month · Last
30 Days · Custom**, Monday-start weeks, default This Week, default sort date
descending. Active filters render as removable chips plus **Clear all**.
Mobile collapses to a **Filters** button + count badge. All still true.

## Shared: the KPI card, the pie-chart rule — unchanged

See the original guidance: `label · value (mono, tabular) · secondary line`,
attainment colour only (green ≥100%, amber 70–99%, red <70%), donuts for
2–3-slice outcome/status data, horizontal sorted bars for source (a ranking
question). Still the pattern in every chart below.

---

## `/dashboard` — agent dashboard

Matches the original spec closely, plus one addition: an **Overview / Activity
view toggle** (`view=overview|activity`, URL param) that didn't exist in the
original design.

**Filters:** period presets + custom range, plus the Overview/Activity toggle.

**Overview view — KPI row 1 (4 cards):** Calls Made `n/target` · Appointments
Held `n/target` · Premium `$n/target` · Current Streak (days).
*(Days to MD Deadline, listed in the original spec's row 1, is not currently
rendered as a KPI card — confirm whether that's an intentional drop or a gap
before treating this as final.)*

**KPI row 2 (5 cards):** Dial-to-Connect Rate · No-Show Rate · Referrals
Given · Recruiting Conversations · Pipeline Value (open/scheduled
appointments' expected premium).

**Charts (5, 2-up grid, funnel full-width):** Call Outcomes (donut) ·
Appointment Status (donut) · Call Source (horizontal bar) · 8-Week Trend
(bars + target line) · Conversion Funnel (stepped, full width, spans both
columns). Matches the original spec's chart set exactly.

**Activity view:** renders `<DailyBreakdownTable>` (the same shared
component `/team`'s Activity view uses) for the same period — a day-by-day
table instead of the chart dashboard. Ends in a **Total** row (desktop table
footer) / card (mobile) summing every column across the filtered period —
P10.

**Empty state:** "Nothing logged yet this week…" + Log activity button, shown
when the trailing 8-week window and current period are both empty — matches
the original spec's empty-state intent.

**Header (mobile only):** an "Activity logs" shortcut button to `/logs`.

---

## `/today` — the callback queue

Renamed **"My Day"** in the live nav (`docs/09-account-and-auth.md`'s app
shell section — `nav-items.ts` labels it "My Day"), route unchanged at
`/today`. Structure matches the original spec closely, with one addition
(a Recent Activity feed) not in the original design.

**No period filters** — always "today," as originally specified.

**KPI strip (3 tiles):** Calls logged (today) · Due today · Overdue
(warn-styled when > 0).

**Next Up card:** the single most-overdue/soonest-due follow-up, featured —
contact name, last note (or "Called Nx" if no note), overdue/due-today
badge. Tap opens the quick-log dialog pre-filled with that contact. Per-row
menu: **Snooze 1 day · Snooze 1 week · Mark done** — matches spec.

**Rest of queue:** plain list below Next Up, same actions, revealed via
"View all (n)". **Empty state:** "Nothing due today. Set a follow-up when you
log a call and it'll show up here." — matches spec verbatim.

**Recent activity (new, not in original spec):** last 7 days across all
activity types, icon + contact + summary + date, "View all" → `/logs`.
Empty state: "Nothing logged yet."

**Header:** primary "Log Activity" button opening the shared quick-log
dialog.

---

## `/contacts` — contact list

Matches the original spec's shape, with **phone** added as a real column
(P9 — see `docs/02-data-model.md`; the original design deliberately excluded
phone) and richer import entry points than originally specified.

**Filters:** live-debounced name search (`q`, 250ms). *(The original spec
also called for filtering by last-contacted range, source, last outcome, and
has-open-follow-up — only text search is currently implemented; treat those
as unshipped, not removed.)*

**Header actions:** "Import from phone" (Contact Picker API, feature-detected
— Android Chrome/Edge and flag-gated WebKit only), "Download template,"
"Import from Excel" (→ `/import`), "Add contact" (name + **phone, both
required**). **P10:** the shared `<PageHeader>` stacks the action row below
the title under `sm:` instead of forcing it into a `shrink-0` slot beside a
truncating title — fixes these four buttons overflowing the viewport on
narrow phones (every page using `<PageHeader>` with an action got the same
fix, not just this one).

**Table:** Contact · Phone · Times called · Last called · Last outcome ·
Next follow-up. Mobile collapses to cards. *(No CSV export currently on this
page, despite the original spec calling for one.)*

**Empty state:** "No contacts yet. They appear automatically when you log a
call." or "No contacts matching "{q}"." when searching.

## `/contacts/[id]` — contact detail

Matches spec: full call history, appointments, sales, Log a call entry
point. Header shows name + phone, with "Log appointment" and "Log a call"
actions. "Appointments & sales" card only renders if either exists; "Call
history" card shows every call with outcome badge, notes, and follow-up
status. Read-only — no inline editing on this page, only quick-add entry
points.

---

## `/appointments`

Matches the original spec's shape closely, with **one confirmed removal**:
the "mark held → prompt for sale" flow described in the original spec does
**not** exist in the live code. Status changes are a plain inline `<Select>`
with no follow-on dialog of any kind — worth a product decision on whether
to rebuild it, since the original spec's stated reason for it still holds
("without that prompt the sales log stays empty and the funnel's last stage
is permanently zero").

**Filters:** period + custom, status (multi is not implemented — it's a
single-select dropdown, not the multi-select the original spec called for),
contact-name search.

**KPI strip (4 cards, shown only when rows exist):** Scheduled · Held ·
No-show rate · Open premium (sum of scheduled rows' expected premium).

**Table:** Date · Contact · Type · Status (inline-editable `<Select>`,
persists immediately) · Expected Premium · Referrals · row actions
(Edit/Delete). *(Notes is not a table column, despite the original spec
listing it — visible on the edit form and contact detail instead.)*

**Empty state:** "No appointments between {from} and {to} with these
filters." + Clear all.

**Form:** contact picker (create only), date (max today), optional type,
status select, conditional follow-up chip picker (shown once status is
held/no_show/rescheduled/cancelled), expected premium, referrals given,
notes. Offline-fallback submit on create.

---

## `/sales`

Matches the original spec, including CSV export.

**Filters:** period + custom, client-name search, sort (date desc default,
or premium desc via clickable column header — not a general sort-by-any
column as the original spec's "sort by date or premium" line implied, but
covers the same two options).

**KPI strip (4 cards):** Sales (count) · Total premium · Average premium ·
Largest sale.

**Table:** Date · Client · Product Type · Premium · row actions. Sticky
footer row: "Total (n filtered)" with summed premium, matching the spec's
"reflects the filtered set" requirement.

**CSV export:** `/sales/export?from&to&search`, columns Date/Client/Product
Type/Premium, filename `sales-{from}-to-{to}.csv`.

**Form:** contact picker (create only), date (max today), product type
select (Universal Life / Term Life / Critical Illness / Disability / Other,
free-text on Other), premium, optional follow-up chip picker, notes.

---

## `/recruiting`

Matches the original spec's shape. **Status vocabulary changed** (P8a — see
`docs/02-data-model.md`): live values are `contacted | marketing_presented |
recruited | certified | licensed | declined`, not the original spec's
`contacted | interviewed | joined | licensed | declined`. Legacy labels
("Interview Scheduled", "Interviewed", "Joined") are remapped on import for
backward compatibility.

**Filters:** period + custom, status select (single, not multi as originally
specced).

**KPI strip (4 cards):** Conversations (total rows) · Marketing Presented
(status ∈ marketing_presented/recruited/certified/licensed) · Recruited
(status ∈ recruited/certified/licensed) · Licensed.

**Table:** Date · Prospect · Source · Status (inline-editable) · row
actions. No CSV export (unlike `/sales`).

**Form:** prospect name (create only, plain text — no contact picker, unlike
appointments/sales), date, source (optional), status, notes.

---

## `/logs` — unified activity list (new, not in original spec)

Primary nav entry point, per `docs/03-ui.md`'s route table — replaces plain
quick-links that used to sit atop `/dashboard`. Not read-only browsing of
everything at once; a 4-way tab switcher, one activity type visible at a
time.

**Tabs:** Call / Appointment / Sale / Recruiting (`type` param), each with an
icon and a live count badge for the selected period.

**Filters:** period + custom (shared `FilterBar`), tab selection.

**Per tab:** trimmed table (same row components as the dedicated pages),
capped at 50 rows, same inline actions. Below appointment/sale/recruiting
tables (not calls): "Need filters, sorting, or CSV export? Open the full
/{type} page →" linking to the dedicated screen.
- Call columns: Date, Contact, Source, Outcome, Notes.
- Appointment columns: Date, Contact, Type, Status, Expected premium, Referrals.
- Sale columns: Date, Client, Product type, Premium.
- Recruiting columns: Date, Prospect, Source, Status.

**Empty state per tab:** "No {type} logged in this period."

**Header:** "Log activity" button opening the shared quick-log dialog.

---

## `/log` — quick log (mobile-first, thumb zone)

**4-way tab switcher confirmed live**, matching `docs/03-ui.md`'s
description: Call / Appointment / Sale / Recruiting (`LogTypeSwitcher`),
each rendering the same create-form component used on its dedicated page —
not separate implementations. Call is the default tab.

**Deep-link prefill:** `?contact=id` pre-populates the contact and shows a
"Recent history" card (last 3 calls: date, outcome, notes) — used by
`/today` and `/contacts/[id]`'s Log a call actions.

Within the Call tab, matches the original five-field flow: date chip
(Today/back-date, max today), contact picker, source, outcome, "Call back
on…" chips once an outcome is chosen, notes. Offline-fallback submit;
success navigates to `/today` unless invoked inside a modal.
**Source auto-fill (P10):** picking an existing contact from the picker that
already has a prior call on file collapses the Source field into a
read-only summary pre-filled with that contact's most recent source,
with a "Change" link to reopen the picker — new contacts (or ones with no
prior call) still ask as before.

`/log/[id]/edit` reuses the same form in edit mode (no contact picker post-
creation), saves via `updateCallAction`, redirects to `/logs`.

---

## `/clients` — clients derived from sales (new, not in original spec)

Not a separate entity or table — a filtered/aggregated view over `contacts`
joined to `sales!inner` (explicit in-code rationale: "a client isn't a
separate entity — it's any contact with at least one recorded sale").

**Filters:** plain name search (`q`, full page reload on submit — not
debounced like `/contacts`).

**Header actions:** Download template, Import from Excel. No "Add client" —
clients only appear via a logged sale.

**Table:** Client (→ contact detail) · Phone · Sales (count) · Last sale ·
Total premium.

**Empty state:** "No clients yet. They appear here once a sale is logged."
or "No clients matching "{q}"." when searching.

---

## `/notes` — meeting notes (new, not in original spec)

A printable chronological timeline of every call/appointment/sale note for
one contact — built for handing to a compliance/audit context or printing,
not a general notes feature.

**Contact selection:** type-ahead picker, navigates to `?contact=id`.

**Timeline table:** rows merged from calls/appointments/sales, newest first.
Columns: (print-hidden checkbox) · Date · Type badge · Details of
Discussions · Actions (follow-up date/done marker or "—"). **P10:** an
appointment's `appt_type` (e.g. "Solutions Presented," "Login Shown" — what
actually happened in the meeting) now renders in the Actions column above
the follow-up line, instead of folded into the Details of Discussions
summary — calls/sales rows are unaffected, they never carried a type.

**Selective print:** every row checkbox-selected by default, "Select all"
toggle, "Print" button (disabled when nothing selected) triggers
`window.print()` with print CSS hiding unselected rows and all chrome —
prints only the checked entries, black-on-white, headed "Meeting Notes —
{name}".

**Empty state:** "Nothing logged for {name} yet." (contact selected, no
entries) or the bare picker with explanatory copy (no contact selected).

---

## `/import` — spreadsheet import

Substantially more built out than the original spec's basic-xlsx-upload
description.

**Two templates**, downloadable from `/import/template?type=contacts|clients`:
- **Contacts** — `Contacts` sheet, `Contact Name` + `Phone Number`
  (**phone mandatory**).
- **Clients** — `Sales Log` sheet, `Date, Client Name, Product Type, Premium
  Amount, Notes, Phone` — a row both creates the contact and the sale.

**Five recognized sheets:** `Contacts`, `Call Log`, `Appointment Log`,
`Sales Log`, `Recruiting Log`. The four activity sheets accept an optional
trailing `Phone` column; only the plain `Contacts` sheet requires it. Enum
labels are Title-Case in the sheet, mapped to snake_case DB values, with
legacy recruiting labels explicitly remapped onto the current pipeline
vocabulary (P8a).

**Flow:** Upload → Preview (ready/error/skipped-blank counts, per-sheet
breakdown, scrollable error list `{sheet} row {n}: {errors}`, "Commit {n}
rows") → Done (imported/skipped/failed summary, links to `/today` and
`/contacts`).

**Dedup:** phone-first then name matching, so re-uploading the same file
never creates duplicates. **Rate-limited:** 5 imports/hour via
`check_rate_limit`.

---

## `/team` — SMD dashboard

Matches the original spec closely; one addition (a third **Activity** view)
not in the original two-view (Summary/Daily) design.

**Filter bar:** period + custom · agent multi-select (`agents` param) ·
3-way view toggle `summary | daily | activity` (spec called for 2).

**Header:** links to Organization, Goals, Invites, Members, Audit. "Export
CSV" (summary view only).

**Team KPI strip (5 cards):** Total Calls `n/target` · Total Appts Held
`n/target` · Total Premium `n/target` · Agents On Goal `x/N` · Quiet Agents
(clickable — filters the multi-select to just those agents, matching spec).

**Quiet agents card:** name link to `/team/[agentId]` + **Nudge** button per
row, matching spec (7-day rate limit, atomic since the P9f fix — see
`docs/04-security.md`).

**Summary view:** roster table (Agent w/ override marker and Quiet badge ·
Calls n/target + bar · Appts Set · Appts Held · Premium · Streak · Last
logged), plus charts: Calls by Agent (bar, target line) · Team Call Outcomes
(donut) · Team Call Source (bar) · 8-Week Team Trend. Matches spec's chart
set.

**Daily view:** `DailyGrid` — dates down the left, one column per selected
agent, cell states: solid+glow (minimum met), dim (partial), sunken (zero).
Matches spec's "attendance sheet" description exactly.

**Activity view (new):** the same `DailyBreakdownTable` component
`/dashboard`'s Activity view uses.

**Filtered to one agent:** `/team/[agentId]` deliberately mirrors the
agent's own `/dashboard` layout — same KPI rows, same 5 charts, same funnel,
via `agent_aggregate`/`team_target`. Counts only, enforced by `is_upline_of`
RLS — matches spec's core guarantee exactly. 404s (not a silent empty
result) if the agent doesn't resolve.

**CSV export:** roster export via `/team/export` (columns: Agent, Calls,
Calls Target, Appts Set, Appts Held, Appts Held Target, Premium, Premium
Target, Streak, Last Logged, Has Override) and per-agent daily grid export
via `/team/[agentId]/daily/export`.

---

## `/team/targets` — goal management

Renamed **"Goals"** in nav copy (targets remain `targets` in the schema and
route). Matches spec: org-default card, per-agent override rows (collapsed,
expand to edit), all four target dimensions, insert-only/effective-Monday
semantics with explicit copy stating past weeks keep their original goal.

---

## Screens not in the original spec's screen-specs file at all

These existed only as one-line mentions in `docs/09-account-and-auth.md`
(or not at all) and have since grown into full screens:

- **`/team/invites`, `/team/members`, `/team/organization`, `/team/audit`**
  — SMD-only screens (P11: `requireLeader()` no longer admits admin),
  detailed in `docs/09-account-and-auth.md`.
- **`/admin/orgs`, `/admin/agents`, `/admin/audit`, `/admin/pilot`** —
  admin screens, detailed in `docs/09-account-and-auth.md`. `/admin/pilot`
  in particular is a purpose-built pilot-health dashboard (10-day active-
  logger window, 8-of-10 bar, per-org at-risk flagging) tied directly to the
  P7 pilot instrumentation goal in `docs/06-build-phases.md`. **P11, new:
  `/admin/agents/[agentId]`** — a per-agent record page reached by clicking
  an agent on `/admin/agents`, with a "change email" action (mails the
  agent a confirm link; the change only applies once they click it) — see
  `docs/09-account-and-auth.md`.
- **`/admin/feedback`** (P10, new) — every bug/issue/feature report submitted
  via `/feedback`, unscoped across every organization (same shape as
  `/admin/audit`). One card per report: reporter name/email/org, category
  badge, subject, full message, optional page context, and a status
  `<Select>` (New/Reviewed/Resolved) that persists immediately. `/feedback`
  itself (any role, reached from the account menu) and the Terms &
  Conditions screens (`/terms`, `/terms/accept`) are detailed in
  `docs/09-account-and-auth.md`.
- **`/confirm-email-change/[token]`** (P11, new) — the no-login confirm step
  for an admin-initiated email change; detailed in
  `docs/09-account-and-auth.md`.

---

## States, on every screen — mostly matches, one gap

Loading → skeletons matching final layout. Empty → names the reason, offers
the fix — confirmed true screen-by-screen above. Error → what failed + retry.
Mobile → tables collapse to cards, donuts stay, wide bars scroll.

**One confirmed gap, already tracked in `TODOS.md`:** route-level
`loading.tsx`/`error.tsx` boundaries (as opposed to component-level
skeletons and empty states, which are consistently implemented) are
outstanding work, per `docs/03-ui.md`'s Rules section. Don't re-flag it here
as new — it's the same known item.
