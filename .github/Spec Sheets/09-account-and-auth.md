# Account, auth, and the app shell

Every screen a person passes through before they ever log a call. Previously
this existed only as security controls in `docs/04-security.md`; those are the
rules, this is the product.

---

## Who creates what

There is no public signup. Three ways an account comes into existence:

1. **You (admin) provision an organization.** `/admin/orgs/new` — org name, SMD's
   name and email. Creates the org and sends the SMD an invitation. Two orgs
   exist today; this screen is used a handful of times a year.
2. **An SMD invites an associate.** `/team/invites` — email, optional name. One
   at a time, or paste a list of emails for bulk.
3. **Nobody else.** A stranger hitting `/signup` with no token gets a page that
   explains the tool is invite-only and offers a "request access" mailto. It does
   not offer a form — a form implies an account is coming.

---

## Screens

### `/login`
Email + password, and a "Email me a sign-in link" option. Magic link is the
default path on mobile — associates will not type a password on a phone reliably.
- Wrong password: "Email or password doesn't match." Never say which was wrong.
- Unknown email: same message. Do not confirm whether an account exists.
- Deactivated account: "This account is no longer active. Contact your SMD."
- Rate limited: "Too many attempts. Try again in 15 minutes, or use a sign-in link."
- Below the fold: one line of what the product is, for the person who forgot.

### `/invite/[token]` — accept invitation
Landing page from the invitation email. Shows **who invited them and into which
team** before asking for anything — "Priya Nair invited you to the Rana Team on
WFG Team Tracker." An invitation that does not name the inviter looks like phishing.
- Sets name + password (or continues with magic link), accepts the privacy notice.
- Expired token: "This invitation expired on 20 Aug. Ask your SMD to send a new one."
  Offers a one-click "Request a new invitation" that emails the inviter.
- Already accepted: routes to `/login` with a note.
- Invalid token: generic "This invitation link isn't valid."

### `/onboarding` — first run, 3 steps, skippable
Runs once, after accepting an invitation.
1. **Your targets** — read-only, shows the targets the SMD set, with one line:
   "Your SMD sets these. You'll see your progress against them."
2. **What your SMD can see** — an actual screenshot-style panel: numbers yes,
   contact names no. This is a trust moment and it is also the adoption argument.
   Do not bury it in a policy document.
3. **Bring your spreadsheet** — offer the importer, or "Start fresh".
Ends on `/log` with the empty-state coach mark. Total time under 60 seconds.

### `/forgot-password` → `/reset-password/[token]`
Standard. Always says "If that email has an account, we've sent a link" —
never confirms existence. Token single-use, 1 hour.

### `/mfa/setup`
Required for `leader` and `admin` before first access to `/team`. TOTP QR +
manual key, then a verification code, then **eight recovery codes shown once**
with a download button. An SMD locked out of their own team dashboard is a
support incident you do not want in week one.
Associates: optional, offered in settings.

### `/profile`
Their identity, separate from their preferences.
- Full name (editable), email (change requires confirming both addresses),
  photo/initials, role and team (read-only, with "set by your SMD"),
  joined date, MFA status with enable/disable.
- Password change (requires current password).
- **Sessions**: list of active sessions with device and last-seen, and
  "Sign out everywhere". Cheap to build, and it is the first thing anyone asks
  for after losing a phone.

### `/settings`
How the product behaves for them.
- **Targets** — read-only card, "set by your SMD", with the effective date.
- **Notifications** — see the next section; each toggle independent.
- **Time zone** — defaults from the browser, editable. A wrong time zone puts
  calls on the wrong day and silently breaks the streak.
- **Week start** — locked to Monday, shown as a fact not a setting, so nobody
  wonders why their week looks different from the roster.
- **Your data** — "Download everything" (JSON + CSV) and "Delete my account",
  which spells out exactly what is deleted (contacts, notes) and what is retained
  (anonymised daily counts your SMD already saw).

### `/logout`
Clears the session and returns to `/login` with "You're signed out."

### SMD-side account screens
- `/team/invites` — pending invitations with sent date, expiry, and Resend /
  Revoke. Bulk paste of emails. Shows seat count if you ever charge per seat.
- `/team/members` — active roster with Deactivate. Deactivating explains what
  happens: access revoked, history retained, they disappear from the roster.
- `/team/audit` — target changes, invitations, deactivations. Who, what, when.

### Admin screens
`/admin/orgs` (create org, assign SMD), `/admin/agents` (move an agent between
uplines, reactivate, hard-delete on request), `/admin/audit` (everything).

---

## Notifications — the part that decides whether this works

A tracker nobody opens is a spreadsheet with extra steps. Three notifications,
all default-on, all individually switchable off:

| When | To | What |
|---|---|---|
| Weekday 7:00 PM local, if nothing logged today | Associate | "You haven't logged any calls today. 15 keeps your streak." Deep-links to `/log`. |
| Sunday 6:00 PM local | Associate | Week summary: calls vs target, streak, follow-ups due next week. |
| Monday 8:00 AM local | SMD | Team digest: totals vs target, who is quiet, biggest movers. Deep-links to `/team`. |

Email in v1; push once the PWA is installed. Rules: never more than one per day
per person, never on a day they already logged, and every one has a one-click
unsubscribe that actually works. If an associate turns all three off, that is a
signal about the product — instrument it.

---

## The app shell

**Mobile (primary)** — bottom tab bar, four items, thumb-reachable:
`Log · Today · Me · Team` (Team only renders for leaders). A centre-weighted
**Log** tab, because that is the job. Avatar top-right opens profile/settings/
sign out.

**Desktop** — left rail, same items plus the list screens nested under Me.
Org name and week selector in the header.

**Route guards** — an associate hitting `/team` is redirected to `/dashboard`
with a toast, not shown a 403. A leader hitting another org's URL gets a 404,
never a 403: a 403 confirms the resource exists.

---

## First-run empty states

Zero-data screens are where products lose people. Each one names the next action:

| Screen | Empty state |
|---|---|
| `/log` | Coach mark on the name field: "Log your first call. Takes about five seconds." |
| `/dashboard` | "Nothing logged yet this week. Your dashboard fills in as you log calls." + Log a call button. Do **not** render five charts of zeros. |
| `/today` | "Nothing due today. Set a follow-up when you log a call and it'll show up here." |
| `/team` (new SMD) | "No one on your team yet." + Invite someone, prominent. |
| `/team` (invited, nobody logged) | "3 invitations pending, no activity yet." Lists who hasn't accepted, with Resend. |
| `/sales` | "No sales logged in this range." + Clear filters if filters are active — distinguish *no data* from *no matches*. |
