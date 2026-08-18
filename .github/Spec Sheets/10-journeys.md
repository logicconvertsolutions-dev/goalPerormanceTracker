# User journeys — what actually happens, in order

Written from the user's side of the screen. If a step here has no screen in
`docs/03-ui.md`, `08-screen-specs.md`, or `09-account-and-auth.md`, that is a gap.

---

## The insight this file exists for

Look at the source workbook's Notes column. Seven calls, and five of them say
some version of **"call back"**:

- Bharadwaj — call back
- Pranay Kohad — call back in a month
- Abhilash Pulimamidi — call back Tuesday, to book an appointment
- Prathysuha — call back Monday, to book an appointment

The product is not a logging tool. It is a **callback queue that happens to
produce metrics**. An agent's real question at 9 AM is not "how many calls did I
make last week" — it is **"who am I supposed to call today"**. The spreadsheet
cannot answer that, which is exactly why it stops getting filled in.

Everything in this file follows from that.

---

## Associate — day 1

1. Email arrives: "Priya Nair invited you to the Rana Team." One button.
2. `/invite/[token]` — sees who invited them and into what. Sets a password.
3. `/onboarding` — targets, what the SMD can and cannot see, import offer.
4. Lands on `/log` with a coach mark.
5. Logs one call. Toast confirms. Counter reads `1 / 15 today`.

**Success is a single logged call in the first session.** Not a completed
profile, not a finished import. If they leave without logging once, they do not
come back.

## Associate — a normal day

**Morning, `/today`:** four people due for callback, pulled from follow-up dates
they set when they first logged the call. Each row: name, what was said last
time, how many times called. Tap → the log form pre-filled with that contact.

**During calls:** log each one in five taps. Outcome `Connected` reveals
"Call back on…" with quick chips — *Tomorrow · Monday · Next week · 1 month · Pick a date*.
That single field is what makes tomorrow's `/today` list exist.

**Evening:** batch entry. Many agents log nothing until 8 PM. `/log` must accept a
back-date without friction — a date chip at the top reading *Today* that opens
a picker. A tracker that only accepts same-day entry gets abandoned in week two.

**Sunday 6 PM:** email — calls vs target, streak, follow-ups due next week.

## Associate — week 4

Opens `/dashboard` to see the 8-week trend, not this week's number. Opens
`/contacts` to find someone they spoke to a month ago and remember what was said.
This is where a **contact-centric** view matters: they think "Bharadwaj", not
"call log row 47".

---

## SMD — day 1

1. You provision the org; they get an invitation.
2. Accept → MFA setup (mandatory) → `/team`, which is empty.
3. Empty state: "No one on your team yet." → `/team/invites`, paste 12 emails.
4. `/team/targets` — set the team default. Defaults pre-filled at 50 / 3 / $188 / 15.
5. `/team` now shows 12 pending invitations, nobody logging yet.

**Day 1 must not look broken.** An SMD who sees a dashboard of zeros with no
explanation assumes the tool is broken and stops opening it before their team
ever starts.

## SMD — a normal Monday

1. 8 AM email digest: totals, who is quiet, biggest movers.
2. Opens `/team` — sorted worst-first. Wei Chen, 9 days silent, at the top.
3. Clicks the quiet-agent KPI → roster filters to just those people.
4. **Sends a nudge** — one button per quiet agent that sends "Your SMD noticed
   you haven't logged this week" plus a deep link. Logged to audit, rate-limited
   to one per agent per week. Without this the SMD leaves the app to send a text,
   and the loop breaks outside the product.
5. Filters to Priya, sees 61 calls / 18% booking / 7 held / 0 sales. Knows the
   coaching conversation is about presentation, not activity.
6. Opens the Daily grid, sees four agents with the same heavy-Monday-then-fade
   pattern. That is a team meeting topic, not four one-on-ones.

## SMD — month 3

Exports the roster to CSV for their own upline. Reviews `/team/audit` before a
promotion conversation. Deactivates someone who left; their history stays in the
team's historical numbers, their name leaves the roster.

---

## Journey gaps this exposed

Each of these is now specified; none were before.

1. **Follow-ups** — the actual product. New `follow_up_on` field and a `/today` screen.
2. **Contacts as people** — a `contacts` table so history accumulates per person
   instead of scattering across call rows.
3. **Back-dating** — batch evening entry is the dominant usage pattern.
4. **Nudge from the SMD** — keeps the coaching loop inside the product.
5. **Empty states on day 1** — for both roles, before any data exists.
6. **Notifications** — nothing in this product pulls anyone back without them.
7. **The whole account lifecycle** — invitation through deactivation.
