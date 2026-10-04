# 15 — Dark mode + "match my device" (plan, not built)

Status: **proposal, awaiting sign-off.** `CLAUDE.md` and `03-ui.md` both say
"Light theme only … do not build a dark mode or a theme toggle without
asking." This document is the ask. Once approved, both of those lines get
updated in the same PR that ships the work.

## Goal

A **Appearance** setting on `/settings` with three choices:

| Choice | Behaviour |
|---|---|
| Light | Always the current light navy/gold theme |
| Dark | Always the new dark theme |
| System | Follows the OS (macOS/Windows/iOS/Android), and **switches live** when the OS flips (e.g. phone auto-dark at sunset) without a reload |

Every page — signed-in app, auth pages, login, legal pages, error/loading
states, dialogs, toasts, charts — must render correctly in both, with all
text meeting WCAG AA contrast (4.5:1 body, 3:1 large text/UI glyphs).

## What the review found

The codebase is well set up for this — most of the work is in one place.

- **~1,000 color usages already go through tokens** (`text-fg` ×212,
  `text-fg-3` ×174, `text-fg-2` ×133, `border-line` ×100, `text-acc` ×85, …).
  Re-pointing the tokens re-themes all of them.
- `tailwind.config.ts` already has `darkMode: ['class']`. There are **zero**
  `dark:` classes today, and we should keep it that way: theme by swapping
  CSS variables, not by sprinkling `dark:` variants.
- **The blocker:** tokens are literal hex in `tailwind.config.ts` (deliberately,
  so `bg-ok/15`-style opacity modifiers work). Literal hex can't change per
  theme. The fix is the standard Tailwind 3 pattern
  `rgb(var(--fg) / <alpha-value>)` with channels stored as `20 33 61` — this
  keeps opacity modifiers working **and** makes tokens themeable.
- **`acc` is used two ways**, which breaks under a naive flip:
  - as a text/border color on light surfaces (`text-acc` ×85) → needs to get
    *lighter* in dark mode;
  - as a filled surface with white text (`bg-acc … text-white` ~30 places,
    `bg-acc text-bg` in the primary button) → if `acc` gets lighter,
    `text-white` on it disappears.
  Fix: add an `on-acc` token and replace `text-white`/`text-bg` on `bg-acc`
  fills with `text-on-acc`.
- **Hard-coded colors outside the tokens** (all must be fixed or the page
  won't switch):

  | File | Issue |
  |---|---|
  | `components/ui/sonner.tsx` | `theme="dark"` hard-coded — must follow the resolved theme |
  | `components/shell/page-backdrop.tsx` | white wash gradient over the photo (every app page) |
  | `components/charts/trend-chart.tsx`, `horizontal-bar-chart.tsx` | axis/grid colors as hex/rgba props |
  | `lib/chart-colors.ts` (+ `funnel-chart`, `donut-chart`) | categorical palette validated for a white background only |
  | `app/(app)/today/calendar-card.tsx` | `#2a78d6` / `#1f5fae` chips, `bg-white` dots, `bg-acc text-white` |
  | `app/(app)/today/task-list.tsx` | `#4a3aa7`, `#C7CCD8` checkbox border |
  | `components/shell/notification-bell.tsx` | `#4a3aa7` tone, `text-white` on fills |
  | `components/shell/contact-call-buttons.tsx` | WhatsApp `#128C4B` text on 10% tint |
  | `app/(app)/today/reminder-list.tsx` | `accent-[#0B1E3D]` on native checkbox |
  | `app/(app)/logs/page.tsx` | inline `color: '#fff'` on active filter |
  | `app/(app)/team/daily-grid.tsx` | navy rgba glow |
  | `greeting-hero.tsx`, `quote-card.tsx`, `announcement-banner.tsx`, `calls-to-finish.tsx`, `planner-page-header.tsx`, `due/page.tsx`, `calendar-add-dialog.tsx` | `bg-acc text-white` fills |
  | `app/layout.tsx` | single `themeColor: '#0B1E3D'`; no `color-scheme` |
  | `app/globals.css` | `.lift` shadow + focus ring hard-coded to navy |
  | `tailwind.config.ts` `boxShadow` | shadows are navy-tinted rgba — invisible on dark |

- **Deliberately unchanged:** `app/login/page.tsx` brand panel (already a
  dark navy gradient with white text — fine in both themes; only its white
  form side needs tokens), `mfa-enroll-flow.tsx` QR code `bg-white` (a QR
  code must stay dark-on-white to scan), `icon.tsx` / `apple-touch-icon` /
  `manifest.ts` (app icon is brand art), `lib/notifications/*` (emails are
  rendered by the mail client; out of scope), `notes-table.tsx` `print:`
  classes (print stays light — see below).
- **Pre-existing light-mode issue found along the way:** `fg-3` (`#94A0B8`)
  on white is **2.63:1**, below AA, and it's the second-most-used text color
  (174 places). Recommend darkening it to ~`#6B7690` (≈4.6:1) in the same
  work, since the contrast test below would otherwise fail on light mode.

## Design: dark palette (proposed, contrast-checked)

Navy-black ground, not pure black, so the brand still reads. Elevation in
dark comes from lighter surfaces (panel → panel-2 → hover), not shadow.

| Token | Light (current) | Dark (proposed) |
|---|---|---|
| `bg` / `bg-2` / `canvas` | `#FFFFFF` | `#0E1626` |
| `panel` / `surface` | `#FFFFFF` | `#162036` |
| `panel-2` | `#FFFFFF` | `#1B2740` |
| `hover` | `#F4F4F5` | `#22304D` |
| `sunken` | `#F4F4F5` | `#0A1120` |
| `fg` | `#14213D` | `#E8ECF4` |
| `fg-2` | `#5C6580` | `#B3BCD0` |
| `fg-3` | `#94A0B8` → fix to `#6B7690` | `#8E9AB4` |
| `acc` | `#0B1E3D` | `#8DB4FF` |
| `acc-2` | `#122A54` | `#A9C6FF` |
| `on-acc` (new) | `#FFFFFF` | `#0B1E3D` |
| `gold` | `#C9A227` | `#D9B44A` |
| `ok` / `ok-dim` | `#1B7A43` / `#E4F5EA` | `#4CC97E` / `#12301F` |
| `warn` / `warn-dim` | `#9C6A0A` / `#FBF0DA` | `#E8B04A` / `#33270F` |
| `bad` / `bad-dim` | `#B0392A` / `#FBE6E2` | `#F2806F` / `#3A1A16` |
| `line` | `#E7E2D3` | `#2A3550` |
| `line-2` / `line-3` | navy @ 14% / 22% | `#E8ECF4` @ 14% / 22% |
| shadows | navy rgba | black rgba, heavier |

Measured contrast for the dark proposal (WCAG ratio, worst surface = `hover`):

| Text | on `bg` | on `panel` | on `hover` |
|---|---|---|---|
| `fg` | 15.3 | 13.7 | 11.1 |
| `fg-2` | 9.5 | 8.5 | 6.9 |
| `fg-3` | 6.4 | 5.7 | 4.65 |
| `acc` | 8.7 | 7.8 | 6.3 |
| `ok` / `warn` / `bad` | 8.6 / 9.3 / 7.0 | 7.7 / 8.3 / 6.3 | 6.2 / 6.7 / 5.1 |

Badges: `ok`-on-`ok-dim` 6.8, `warn`-on-`warn-dim` 7.5, `bad`-on-`bad-dim`
6.0. `on-acc` on `acc` 8.0. All pass AA. The green/amber/red-means-attainment
rule in `03-ui.md` is preserved — same meaning, lighter tints.

## Implementation plan

### Phase A — Theme plumbing (no visual change yet)

1. **Preference storage.** A `kautis-theme` cookie (`light` | `dark` |
   `system`), set by a Server Action from the settings page; mirrored to
   `localStorage` for the client.
   - Optional A.1 (needs a migration + review, per the DB workflow): a
     `theme_preference` column on `notification_prefs` (or a new
     `user_prefs` row) so the choice follows the user across laptop and
     phone. Without it, each device remembers its own choice — which is
     arguably right for "System" anyway. **Decision needed** (see below).
2. **No-flash bootstrap.** A tiny inline `<script>` in `<head>` of
   `app/layout.tsx` that runs before first paint: read the preference, resolve
   `system` via `matchMedia('(prefers-color-scheme: dark)')`, and set
   `class="dark"` + `style="color-scheme: dark"` on `<html>`. Add
   `suppressHydrationWarning` to `<html>`. This avoids reading cookies in the
   root layout, which would force every page (including `/login`, `/privacy`,
   `/terms`) to render dynamically.
3. **Live OS switching.** A small client `ThemeProvider` (in
   `components/shell/`) that subscribes to the `matchMedia` `change` event
   while the preference is `system`, toggles the class, and exposes
   `useTheme()` → `{ preference, resolved, setPreference }` for the Toaster
   and charts.
4. **Hand-rolled, no new dependency.** `next-themes` does exactly steps 2–3,
   but rule 11 says no new dependency without asking; the hand-rolled version
   is ~60 lines. **Decision needed** if you'd rather have the library.
5. **Browser chrome.** `viewport.themeColor` becomes a media-query pair (light
   `#0B1E3D` header stays; dark `#0E1626`) and the provider updates the
   `<meta name="theme-color">` when the user picks an explicit theme.
   `color-scheme` on `<html>` makes native scrollbars, date/time pickers,
   `<select>` popups and checkboxes render dark too.

### Phase B — Token layer

6. `globals.css`: move every token to RGB channels under `:root`, add the
   dark set under `.dark`. Add a `@media print { :root, .dark { …light… } }`
   block so printing (Notes print view) is always light.
7. `tailwind.config.ts`: every color becomes `rgb(var(--token) / <alpha-value>)`;
   add `on-acc`; move `boxShadow` to vars (`--shadow-lift`, `--shadow-float`,
   `--shadow-card`). Update the comment that explains why tokens were hex.
8. Fix the `.lift` utility and `*:focus-visible` ring in `globals.css` to use
   vars (ring must be visible on dark).

After this phase ~90% of the UI switches correctly.

### Phase C — Sweep the hard-coded colors (table above)

9. Replace `text-white` / `text-bg` on `bg-acc` fills with `text-on-acc`
   (button `primary` variant, calendar, task list, planner header, due page,
   notification bell filters, calls-to-finish, calendar-add-dialog, daily grid).
10. Brand cards (`greeting-hero`, `quote-card`, `announcement-banner`): switch
    `bg-acc` → fixed `bg-navy` (a brand surface, intentionally navy in both
    themes, white text stays 16.6:1). Give them a subtle `line` border in
    dark so they don't merge into the navy-black page.
11. `page-backdrop.tsx`: wash gradient becomes `--backdrop-wash-*` vars (white
    in light, `#0E1626` at 70–95% in dark) so the mountain photo dims instead
    of glowing.
12. Charts: axis/tick/grid/reference-line colors via `className="fill-fg-3"`
    / `stroke-line` (Recharts passes `className` through to the SVG text), or
    via `useTheme()` reading the var for props that need a literal.
    `lib/chart-colors.ts` gets a dark variant of the categorical + ordinal
    ramp, re-validated for CVD separation and ≥3:1 against `panel` (the
    current file promises a validated order; the dark set needs the same
    check, not a guess).
13. One-off hexes: WhatsApp green text → dark-mode-safe `#3DDC84`;
    `#4a3aa7` violet → a `violet` chart token with a dark value;
    `accent-[#0B1E3D]` → `accent-acc`; `#C7CCD8` → `border-line-3`;
    `logs/page.tsx` inline `#fff` → `on-acc`-style token.
14. `sonner.tsx`: `theme={resolved}` from `useTheme()`.
15. Logo: the rail/header uses `KautisMark variant="navy"`; render the
    `white` variant when resolved theme is dark (CSS-only: show/hide two
    `<img>`s with `dark:hidden` / `hidden dark:block`, so it's correct on
    first paint). Org logos uploaded by SMDs may be dark-on-transparent —
    show them on a light rounded chip in dark mode.

### Phase D — Settings UI

16. New **Appearance** card at the top of `/settings` (shown to every role,
    including admins): a 3-option segmented control (Light / Dark / System)
    with sun/moon/monitor icons from `lucide-react` (already a dependency),
    plus "Currently: Dark (from your device)" helper text when on System.
    Applies instantly, no Save button; Server Action with Zod
    (`z.enum(['light','dark','system'])`) sets the cookie.
17. Optional: a shortcut in the account menu (`account-menu.tsx`).

### Phase E — Verification ("every page switches, letters are visible")

18. **Token contrast unit test (vitest, no new dep).** A table of every
    foreground/background token pair actually used (`fg*`, `acc`, `ok/warn/bad`
    on `bg/panel/panel-2/hover/sunken/*-dim`, `on-acc` on `acc`), parsed
    straight from `globals.css`, asserting ≥4.5:1 (≥3:1 for `fg-4`/icons) in
    **both** themes. Runs in CI on every PR, so a future token tweak can't
    silently break legibility.
19. **Lint guard.** A grep-based test (or ESLint rule) that fails on new raw
    `#hex`, `text-white`, `bg-white`, `text-black` in `src/app` and
    `src/components`, with an allowlist for the intentional exceptions
    (QR code, login brand panel, icons, print classes).
20. **Playwright visual sweep.** `e2e/theme.spec.ts`: for each of the ~57
    routes (seeded agent + SMD + admin logins), load with
    `colorScheme: 'light'` and `'dark'`, assert `<html>` has/doesn't have
    `.dark`, screenshot full page, and open the key dialogs/menus (log
    activity, notifications, account menu, toasts). Also: set preference to
    System, flip `page.emulateMedia({ colorScheme })` mid-session and assert
    the page re-themes without reload; reload with Dark preference and assert
    no light flash (class present before hydration). Run on Chromium +
    WebKit (iOS Safari behaviour) at desktop and phone viewports.
    - Automated AA checks inside these runs need `@axe-core/playwright` —
      a new dev dependency. **Decision needed.** Without it, step 18 covers
      tokens and the screenshots are reviewed by eye.
    - Note: `e2e/` has no specs yet and needs a seeded Supabase to log in;
      this would be the first spec and needs the staging seed/test accounts.
21. **Manual pass on real devices** on `staging.kautis.ca`: iPhone (Safari +
    installed PWA), Android Chrome, macOS and Windows with OS auto-dark —
    verify status bar color, date pickers, toasts, and that a scheduled OS
    switch flips the open app.

### Phase F — Docs (Definition of done)

22. Update `CLAUDE.md` stack note ("Light theme only") and `03-ui.md`
    (theme section, dark token table, the brand-surface rule from step 10).
    Regenerate or retire the stale `ui-mockup.html`.
23. New phase entry in `06-build-phases.md` (P36), ticked when done.
    vitest green, types clean, no new `NEXT_PUBLIC_` vars. pgTAP/db lint only
    matter if option A.1 (DB column) is chosen.

## Rollout

Feature branch off `dev` → `dev` → `staging` (device pass, step 21) →
`master` via PR, per the git workflow. Phases A–C can land as one PR with
the preference **defaulting to Light** so nothing changes for existing
users until they opt in; flipping the default to System is a one-line
follow-up once staging looks right.

## Decisions needed before building

1. **Approve lifting the "light theme only" rule** (`CLAUDE.md`, `03-ui.md`).
2. **Default for existing users:** Light (no surprise; recommended for
   launch) or System (matches the device immediately).
3. **Per-device vs. synced preference:** cookie only (no migration;
   recommended) or also a DB column so it follows the account.
4. **Dependencies:** hand-roll the theme provider (recommended) vs.
   `next-themes`; add `@axe-core/playwright` for automated contrast checks
   (recommended) or rely on the token test + screenshots.
5. **Fix light-mode `fg-3` contrast** (2.63:1 today) in the same work —
   recommended, since it's a visible change to the light theme.
