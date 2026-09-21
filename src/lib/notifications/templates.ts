// Email copy for the three scheduled notifications plus the SMD's ad-hoc
// nudge (09-account-and-auth.md's Notifications table). Plain inline-styled
// HTML -- no react-email or MJML dependency (CLAUDE.md rule 10).
import { appUrl } from './app-url';
import { BRAND } from './brand';
import { signUnsubscribe } from './unsubscribe-token';
import type { NotificationKind } from './window';

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
  // Set only for the three recurring notification kinds below (evening
  // nudge, cycle summary, cycle digest) -- these are the ones Gmail/Yahoo
  // classify as "bulk mail" and gate on a working one-click unsubscribe
  // (RFC 8058) for inbox placement. Threaded through to sendEmail() so it
  // can set the List-Unsubscribe / List-Unsubscribe-Post headers.
  unsubscribeUrl?: string;
}

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

// fullName, roster names, and sentByName are all free-text, user-settable
// fields (agents.full_name, team_roster.full_name) that flow unescaped into
// bodyHtml below -- escape before interpolating into HTML anywhere in this
// file. Not needed for the *Text variants, which are plain text.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatMoney(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function button(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;padding:12px 24px;background:${BRAND.gold};color:${BRAND.navy};font-weight:600;text-decoration:none;border-radius:8px;margin-top:8px;">${label}</a>`;
}

// Always the Kautis mark next to the wordmark -- every email is Kautis
// branding, never an org's own uploaded logo (that logo is for the app
// shell/org settings screens only). Uses the pre-sized 112x112 email
// derivative (public/kautis-logo-email.png), not the 1024x1024/~112KB
// master (public/kautis-logo.png) -- some email image proxies (Gmail's
// especially) apply stricter size/thumbnailing limits to inline images
// than a normal page load, and serving an oversized source image at a
// 28px display size showed up as a broken icon in Gmail's own hero-image
// card even though the URL fetched fine directly.
function header(): string {
  const mark = `<img src="${appUrl('/kautis-logo-email.png')}" alt="${BRAND.name}" width="28" height="28" style="width:28px;height:28px;border-radius:50%;vertical-align:middle;display:inline-block;border:0;" /><span style="color:#fff;font-size:18px;font-weight:700;vertical-align:middle;margin-left:10px;">${BRAND.name}</span>`;
  return `<div style="background:${BRAND.navy};padding:20px 32px;border-radius:14px 14px 0 0;">${mark}</div>`;
}

function unsubscribeUrlFor(agentId: string, kind: NotificationKind): string {
  return appUrl(
    `/unsubscribe?agent=${encodeURIComponent(agentId)}&kind=${kind}&sig=${signUnsubscribe(agentId, kind)}`
  );
}

function footer(agentId: string, kind: NotificationKind | null): { html: string; text: string } {
  const settingsUrl = appUrl('/settings');
  if (!kind) {
    return {
      html: `<p style="margin-top:32px;font-size:12px;color:${BRAND.muted};">Manage your notification preferences at <a href="${settingsUrl}" style="color:${BRAND.muted};">${settingsUrl}</a>.</p>`,
      text: `Manage your notification preferences: ${settingsUrl}`,
    };
  }
  const unsubscribeUrl = unsubscribeUrlFor(agentId, kind);
  return {
    html: `<p style="margin-top:32px;font-size:12px;color:${BRAND.muted};"><a href="${unsubscribeUrl}" style="color:${BRAND.muted};">Unsubscribe from this email</a> &middot; <a href="${settingsUrl}" style="color:${BRAND.muted};">Manage all notifications</a></p>`,
    text: `Unsubscribe from this email: ${unsubscribeUrl}\nManage all notifications: ${settingsUrl}`,
  };
}

// `maxWidth` defaults to the 480px every short email uses. The cycle digest
// passes 600 -- the standard wide-email width -- because its roster table has
// eight columns and 480 forces a phone-hostile shrink. No other email needs it.
function wrap(
  bodyHtml: string,
  agentId: string,
  kind: NotificationKind | null,
  maxWidth = 480
): EmailContent['html'] {
  const f = footer(agentId, kind);
  return `<div style="font-family:'Plus Jakarta Sans',-apple-system,Helvetica,Arial,sans-serif;max-width:${maxWidth}px;margin:0 auto;">
    ${header()}
    <div style="background:${BRAND.bg};padding:32px;border:1px solid #E7E2D3;border-top:none;border-radius:0 0 14px 14px;color:${BRAND.text};">
      ${bodyHtml}
      ${f.html}
    </div>
  </div>`;
}

function wrapText(bodyText: string, agentId: string, kind: NotificationKind | null): string {
  return `${bodyText}\n\n${footer(agentId, kind).text}`;
}

export interface EveningNudgeData {
  agentId: string;
  fullName: string;
  streakDays: number;
  minCallsPerDay: number;
}

export function eveningNudgeEmail(d: EveningNudgeData): EmailContent {
  const logUrl = appUrl('/log');
  const streakLine =
    d.streakDays > 0
      ? `${d.minCallsPerDay} calls keeps your ${d.streakDays}-day streak alive.`
      : `${d.minCallsPerDay} calls starts your streak.`;
  const bodyHtml = `
    <p>Hi ${escapeHtml(firstName(d.fullName))},</p>
    <p>You haven't logged any calls today. ${streakLine}</p>
    ${button(logUrl, 'Log a call')}`;
  const bodyText = `Hi ${firstName(d.fullName)},\n\nYou haven't logged any calls today. ${streakLine}\n\nLog a call: ${logUrl}`;
  return {
    subject: "You haven't logged any calls today",
    html: wrap(bodyHtml, d.agentId, 'evening_nudge'),
    text: wrapText(bodyText, d.agentId, 'evening_nudge'),
    unsubscribeUrl: unsubscribeUrlFor(d.agentId, 'evening_nudge'),
  };
}

export interface CycleSummaryData {
  agentId: string;
  fullName: string;
  callsMade: number;
  callsTarget: number;
  streakDays: number;
  followUpsDueNextCycle: number;
}

// Notification kind stays 'sunday_summary' (the DB/URL identifier, unchanged
// since P18) even though it no longer fires on Sunday -- see
// private.enqueue_due_notifications()'s doc comment for why.
export function cycleSummaryEmail(d: CycleSummaryData): EmailContent {
  const dashboardUrl = appUrl('/dashboard');
  const bodyHtml = `
    <p>Hi ${escapeHtml(firstName(d.fullName))},</p>
    <p>This cycle: <strong>${d.callsMade} of ${d.callsTarget}</strong> calls, a
    <strong>${d.streakDays}-day</strong> streak, and
    <strong>${d.followUpsDueNextCycle}</strong> follow-up${d.followUpsDueNextCycle === 1 ? '' : 's'} due next cycle.</p>
    ${button(dashboardUrl, 'View your dashboard')}`;
  const bodyText = `Hi ${firstName(d.fullName)},\n\nThis cycle: ${d.callsMade} of ${d.callsTarget} calls, a ${d.streakDays}-day streak, and ${d.followUpsDueNextCycle} follow-up(s) due next cycle.\n\nView your dashboard: ${dashboardUrl}`;
  return {
    subject: 'Your cycle in review',
    html: wrap(bodyHtml, d.agentId, 'sunday_summary'),
    text: wrapText(bodyText, d.agentId, 'sunday_summary'),
    unsubscribeUrl: unsubscribeUrlFor(d.agentId, 'sunday_summary'),
  };
}

// ---------------------------------------------------------------------------
// Cycle digest (P26). The pre-P26 version was four sentences of team totals.
// An SMD's actual job on cycle-close day is deciding who to talk to and about
// what, so this carries the funnel rates that say WHERE a miss happened, and
// names individuals with the number that earned them the mention.
//
// All of it is counts and sums over daily_metrics -- no contact_name, no
// notes, no client_name (CLAUDE.md rule 2). The only names are the leader's
// own downline, which they already see on /team.
// ---------------------------------------------------------------------------

const OK = '#1E7F4F';
const WARN = '#B07503';
const BAD = '#B4341F';
const LINE = '#E7E2D3';
const SOFT = '#F7F5EF';

/** Integer percent, 0 when the denominator is 0 -- never NaN/Infinity in copy. */
function pctOf(n: number, d: number): number {
  return d > 0 ? Math.round((100 * n) / d) : 0;
}

/** Percent, or null when there is no denominator to divide by. */
function rateOf(n: number, d: number): number | null {
  return d > 0 ? Math.round((100 * n) / d) : null;
}

function toneFor(p: number): string {
  return p >= 100 ? OK : p >= 70 ? WARN : BAD;
}

function deltaOf(cur: number, prev: number): number | null {
  const d = cur - prev;
  return d === 0 ? null : d;
}

// HTML entities, not the literal glyphs -- some Windows mail clients still
// mangle a raw U+25B2 depending on the declared charset.
function arrowHtml(d: number | null): string {
  if (d === null) return 'flat vs last';
  return d > 0 ? `&#9650; ${d} vs last` : `&#9660; ${Math.abs(d)} vs last`;
}

function arrowText(d: number | null): string {
  if (d === null) return 'flat vs last cycle';
  return d > 0 ? `up ${d} vs last cycle` : `down ${Math.abs(d)} vs last cycle`;
}

export interface CycleDigestTotals {
  calls: number;
  apptsSet: number;
  apptsHeld: number;
  sales: number;
  premiumCents: number;
  recruits: number;
}

export interface CycleDigestTargets {
  calls: number;
  apptsHeld: number;
  premiumCents: number;
}

export interface CycleDigestAgent {
  name: string;
  calls: number;
  callsTarget: number;
  apptsSet: number;
  apptsHeld: number;
  sales: number;
  premiumCents: number;
  recruits: number;
  /** Pre-formatted short date ("Sep 18"), or null if they have never logged. */
  lastActive: string | null;
  stale: boolean;
}

export interface CycleDigestCallout {
  name: string;
  reason: string;
  hint?: string;
  severe: boolean;
}

export interface CycleDigestData {
  agentId: string;
  fullName: string;
  /** The cycle these numbers cover, e.g. "Sep 11-20" -- the one that just
   * closed. Named in the copy because the email arrives on the *next*
   * cycle's first morning. */
  cycleLabel: string;
  /** The comparison cycle, e.g. "Sep 1-10". */
  priorLabel: string;
  totals: CycleDigestTotals;
  prior: CycleDigestTotals;
  targets: CycleDigestTargets;
  /** Set when most of the roster trips the same rule -- a callout naming
   * everybody is not a callout, it is a team-level fact. */
  banner: { title: string; body: string } | null;
  attention: CycleDigestCallout[];
  movers: { name: string; note: string }[];
  agents: CycleDigestAgent[];
}

// Table-based grid: Outlook's Word renderer supports neither flexbox nor
// CSS grid, so every column here is a real <td>.
function statTile(label: string, value: string, sub: string, tone: string): string {
  return `<td width="33%" style="padding:12px 10px;background:${SOFT};border:1px solid ${LINE};border-radius:10px;vertical-align:top;">
    <div style="font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:${BRAND.muted};">${label}</div>
    <div style="font-size:22px;font-weight:700;color:${tone};line-height:1.25;margin-top:3px;">${value}</div>
    <div style="font-size:11px;color:${BRAND.muted};margin-top:2px;">${sub || '&nbsp;'}</div>
  </td>`;
}

function sectionTitle(t: string): string {
  return `<p style="margin:26px 0 10px;font-size:13px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:${BRAND.navy};">${t}</p>`;
}

// Notification kind stays 'monday_digest' (the DB/URL identifier, unchanged
// since P18) even though it no longer fires on Monday -- see
// private.enqueue_due_notifications()'s doc comment for why.
export function cycleDigestEmail(d: CycleDigestData): EmailContent {
  const teamUrl = appUrl('/team');
  const callPct = pctOf(d.totals.calls, d.targets.calls);
  const heldPct = pctOf(d.totals.apptsHeld, d.targets.apptsHeld);
  const premPct = pctOf(d.totals.premiumCents, d.targets.premiumCents);

  const setRate = rateOf(d.totals.apptsSet, d.totals.calls);
  const showRate = rateOf(d.totals.apptsHeld, d.totals.apptsSet);
  const closeRate = rateOf(d.totals.sales, d.totals.apptsHeld);
  const priorSetRate = rateOf(d.prior.apptsSet, d.prior.calls);
  const priorShowRate = rateOf(d.prior.apptsHeld, d.prior.apptsSet);
  const priorCloseRate = rateOf(d.prior.sales, d.prior.apptsHeld);

  const dCalls = deltaOf(d.totals.calls, d.prior.calls);
  const dHeld = deltaOf(d.totals.apptsHeld, d.prior.apptsHeld);
  const dPrem = deltaOf(d.totals.premiumCents, d.prior.premiumCents);
  const dRecruits = deltaOf(d.totals.recruits, d.prior.recruits);

  const tilesA = [
    statTile('Calls', String(d.totals.calls), `${callPct}% of ${d.targets.calls} &middot; ${arrowHtml(dCalls)}`, toneFor(callPct)),
    statTile('Appts set', String(d.totals.apptsSet), setRate === null ? '&nbsp;' : `${setRate}% set rate`, BRAND.text),
    statTile('Appts held', String(d.totals.apptsHeld), `${heldPct}% of ${d.targets.apptsHeld} &middot; ${arrowHtml(dHeld)}`, toneFor(heldPct)),
  ];
  const tilesB = [
    statTile('Sales', String(d.totals.sales), '&nbsp;', BRAND.text),
    statTile('Premium', formatMoney(d.totals.premiumCents), `${premPct}% of ${formatMoney(d.targets.premiumCents)} &middot; ${arrowHtml(dPrem)}`, toneFor(premPct)),
    statTile('Recruiting convos', String(d.totals.recruits), arrowHtml(dRecruits), BRAND.text),
  ];
  const tileRow = (tiles: string[]) => `<tr>${tiles.join('<td width="10"></td>')}</tr>`;

  // Sales are logged independently of appointments, so a close rate can
  // legitimately exceed 100% (more sales than held appts in the window).
  // Showing "300%" reads as a bug, so past 100 it falls back to the raw
  // ratio, which is the honest statement of the same fact.
  const funnelCell = (label: string, val: number | null, prev: number | null, raw?: string) => {
    const shown = val === null ? '&mdash;' : val > 100 && raw ? raw : `${val}%`;
    const move = val !== null && prev !== null ? deltaOf(val, prev) : null;
    const tail = move === null ? 'no change' : move > 0 ? `&#9650; ${move} pts` : `&#9660; ${Math.abs(move)} pts`;
    return `<td style="padding:10px 12px;border:1px solid ${LINE};border-radius:10px;">
      <div style="font-size:11px;color:${BRAND.muted};">${label}</div>
      <div style="font-size:17px;font-weight:700;color:${BRAND.text};margin-top:2px;">${shown}
        <span style="font-size:11px;font-weight:600;color:${BRAND.muted};">${tail}</span></div>
    </td>`;
  };

  const bannerHtml = d.banner
    ? `<div style="margin-top:22px;padding:12px 14px;background:#FCF3F2;border:1px solid #F0D5D1;border-left:4px solid ${BAD};border-radius:8px;">
        <div style="font-size:13px;font-weight:700;color:${BAD};">${escapeHtml(d.banner.title)}</div>
        <div style="font-size:13px;color:${BRAND.text};margin-top:3px;">${escapeHtml(d.banner.body)}</div>
      </div>`
    : '';

  const attentionHtml = d.attention.length
    ? `${sectionTitle('Worth a conversation')}
       <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${d.attention
         .map(
           (a) => `<tr><td style="padding:9px 0;border-bottom:1px solid ${LINE};">
             <span style="font-weight:600;color:${BRAND.text};">${escapeHtml(a.name)}</span>
             <span style="color:${a.severe ? BAD : WARN};font-size:13px;"> &middot; ${escapeHtml(a.reason)}</span>
             ${a.hint ? `<div style="font-size:12px;color:${BRAND.muted};margin-top:2px;">${escapeHtml(a.hint)}</div>` : ''}
           </td></tr>`
         )
         .join('')}</table>`
    : '';

  const moversHtml = d.movers.length
    ? `${sectionTitle('Momentum')}
       <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${d.movers
         .map(
           (m) => `<tr><td style="padding:7px 0;border-bottom:1px solid ${LINE};">
             <span style="font-weight:600;color:${BRAND.text};">${escapeHtml(m.name)}</span>
             <span style="color:${OK};font-size:13px;"> &middot; ${escapeHtml(m.note)}</span>
           </td></tr>`
         )
         .join('')}</table>`
    : '';

  const th = (t: string, align: string) =>
    `<th align="${align}" style="padding:7px 6px;font-size:11px;letter-spacing:.03em;text-transform:uppercase;color:${BRAND.muted};font-weight:600;border-bottom:1px solid ${LINE};">${t}</th>`;
  const td = (v: string, align: string, style = '') =>
    `<td align="${align}" style="padding:9px 6px;font-size:13px;border-bottom:1px solid ${LINE};${style}">${v}</td>`;

  const agentRows = d.agents
    .map((a) => {
      const p = pctOf(a.calls, a.callsTarget);
      return `<tr>
        ${td(`<span style="font-weight:600;">${escapeHtml(a.name)}</span>`, 'left')}
        ${td(`${a.calls}<span style="color:${BRAND.muted};font-size:11px;">/${a.callsTarget}</span> <span style="color:${toneFor(p)};font-size:11px;font-weight:600;">${p}%</span>`, 'right')}
        ${td(String(a.apptsSet), 'right')}
        ${td(String(a.apptsHeld), 'right')}
        ${td(String(a.sales), 'right')}
        ${td(formatMoney(a.premiumCents), 'right')}
        ${td(String(a.recruits), 'right')}
        ${td(escapeHtml(a.lastActive ?? 'never'), 'right', `color:${a.stale ? BAD : BRAND.muted};font-size:12px;`)}
      </tr>`;
    })
    .join('');

  const bodyHtml = `
    <p style="margin:0 0 4px;font-size:15px;">Hi ${escapeHtml(firstName(d.fullName))},</p>
    <p style="margin:0 0 2px;font-size:20px;font-weight:700;color:${BRAND.navy};">Cycle ${escapeHtml(d.cycleLabel)} is closed</p>
    <p style="margin:0;font-size:13px;color:${BRAND.muted};">${d.agents.length} ${d.agents.length === 1 ? 'person' : 'people'} on your team &middot; compared against ${escapeHtml(d.priorLabel)}</p>

    ${sectionTitle('Team scorecard')}
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:separate;">
      ${tileRow(tilesA)}<tr><td colspan="5" height="10"></td></tr>${tileRow(tilesB)}
    </table>

    ${sectionTitle('Where the funnel leaks')}
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:separate;">
      <tr>
        ${funnelCell('Calls &rarr; appt set', setRate, priorSetRate)}
        <td width="10"></td>
        ${funnelCell('Set &rarr; held', showRate, priorShowRate)}
        <td width="10"></td>
        ${funnelCell('Held &rarr; sale', closeRate, priorCloseRate, `${d.totals.sales}/${d.totals.apptsHeld}`)}
      </tr>
    </table>
    ${bannerHtml}
    ${attentionHtml}
    ${moversHtml}

    ${sectionTitle('Everyone, by the numbers')}
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">
      <tr>${th('Agent', 'left')}${th('Calls', 'right')}${th('Set', 'right')}${th('Held', 'right')}${th('Sales', 'right')}${th('Premium', 'right')}${th('Recr', 'right')}${th('Last active', 'right')}</tr>
      ${agentRows}
    </table>
    <p style="margin:18px 0 0;">${button(teamUrl, 'View team dashboard')}</p>`;

  const L: string[] = [];
  L.push(`Hi ${firstName(d.fullName)},`, '');
  L.push(`Cycle ${d.cycleLabel} is closed. ${d.agents.length} on your team, compared against ${d.priorLabel}.`, '');
  L.push('TEAM SCORECARD');
  L.push(`  Calls        ${d.totals.calls} (${callPct}% of ${d.targets.calls}, ${arrowText(dCalls)})`);
  L.push(`  Appts set    ${d.totals.apptsSet}${setRate === null ? '' : ` (${setRate}% set rate)`}`);
  L.push(`  Appts held   ${d.totals.apptsHeld} (${heldPct}% of ${d.targets.apptsHeld}, ${arrowText(dHeld)})`);
  L.push(`  Sales        ${d.totals.sales}`);
  L.push(`  Premium      ${formatMoney(d.totals.premiumCents)} (${premPct}% of ${formatMoney(d.targets.premiumCents)})`);
  L.push(`  Recruiting   ${d.totals.recruits} conversations`, '');
  L.push('FUNNEL');
  L.push(`  Calls -> appt set   ${setRate === null ? '-' : `${setRate}%`}`);
  L.push(`  Set -> held         ${showRate === null ? '-' : `${showRate}%`}`);
  L.push(
    `  Held -> sale        ${closeRate === null ? '-' : closeRate > 100 ? `${d.totals.sales} sales / ${d.totals.apptsHeld} held` : `${closeRate}%`}`,
    ''
  );
  if (d.banner) L.push(`** ${d.banner.title}`, `   ${d.banner.body}`, '');
  if (d.attention.length) {
    L.push('WORTH A CONVERSATION');
    for (const a of d.attention) L.push(`  ${a.name} - ${a.reason}${a.hint ? ` (${a.hint})` : ''}`);
    L.push('');
  }
  if (d.movers.length) {
    L.push('MOMENTUM');
    for (const m of d.movers) L.push(`  ${m.name} - ${m.note}`);
    L.push('');
  }
  L.push('EVERYONE');
  for (const a of d.agents) {
    L.push(
      `  ${a.name}: ${a.calls}/${a.callsTarget} calls, ${a.apptsSet} set, ${a.apptsHeld} held, ` +
        `${a.sales} sales, ${formatMoney(a.premiumCents)}, ${a.recruits} recruiting, last active ${a.lastActive ?? 'never'}`
    );
  }
  L.push('', `View team dashboard: ${teamUrl}`);

  return {
    subject: `Your team cycle digest — ${d.cycleLabel}`,
    html: wrap(bodyHtml, d.agentId, 'monday_digest', 600),
    text: wrapText(L.join('\n'), d.agentId, 'monday_digest'),
    unsubscribeUrl: unsubscribeUrlFor(d.agentId, 'monday_digest'),
  };
}

export interface InviteData {
  orgName: string;
  inviterName: string;
  inviteUrl: string;
}

// No agentId/unsubscribe footer -- the invitee isn't an agent yet, there's
// no notification_prefs row to unsubscribe from.
export function inviteEmail(d: InviteData): EmailContent {
  const bodyHtml = `
    <p>Hi,</p>
    <p>${escapeHtml(firstName(d.inviterName))} invited you to join <strong>${escapeHtml(d.orgName)}</strong> on ${BRAND.name}, where you can track your daily activity and see your progress toward your goals.</p>
    <p>Accept the invitation below to create your account and start tracking your calls, appointments, and sales.</p>
    ${button(d.inviteUrl, 'Accept invitation')}
    <p style="font-size:12px;color:${BRAND.muted};margin-top:16px;">This link expires in 7 days.</p>`;
  const bodyText = `Hi,\n\n${firstName(d.inviterName)} invited you to join ${d.orgName} on ${BRAND.name}, where you can track your daily activity and see your progress toward your goals.\n\nAccept the invitation below to create your account and start tracking your calls, appointments, and sales.\n\nAccept invitation: ${d.inviteUrl}\n\nThis link expires in 7 days.`;
  return {
    subject: `${d.inviterName} invited you to join ${d.orgName} on ${BRAND.name}`,
    html: `<div style="font-family:'Plus Jakarta Sans',-apple-system,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;">
      ${header()}
      <div style="background:${BRAND.bg};padding:32px;border:1px solid #E7E2D3;border-top:none;border-radius:0 0 14px 14px;color:${BRAND.text};">
        ${bodyHtml}
      </div>
    </div>`,
    text: bodyText,
  };
}

export interface EmailChangeConfirmationData {
  fullName: string;
  adminName: string;
  confirmUrl: string;
}

// Sent to the *new* address an admin is proposing for an agent's account —
// proves the agent actually controls that inbox before admin_request_email_change
// ever touches auth.users/agents.email. No agentId/unsubscribe footer: this
// isn't a standing preference, and the recipient may not even be signed in
// when they see it.
export function emailChangeConfirmationEmail(d: EmailChangeConfirmationData): EmailContent {
  const bodyHtml = `
    <p>Hi ${escapeHtml(firstName(d.fullName))},</p>
    <p>${escapeHtml(d.adminName)} requested to change the email on your account to this address.
    Confirm below to make the switch — if you weren't expecting this, ignore this email and your
    account won't change.</p>
    ${button(d.confirmUrl, 'Confirm email change')}
    <p style="font-size:12px;color:${BRAND.muted};margin-top:16px;">This link expires in 7 days.</p>`;
  const bodyText = `Hi ${firstName(d.fullName)},\n\n${d.adminName} requested to change the email on your account to this address. Confirm below to make the switch — if you weren't expecting this, ignore this email and your account won't change.\n\nConfirm email change: ${d.confirmUrl}\n\nThis link expires in 7 days.`;
  return {
    subject: 'Confirm your new email address',
    html: `<div style="font-family:'Plus Jakarta Sans',-apple-system,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;">
      ${header()}
      <div style="background:${BRAND.bg};padding:32px;border:1px solid #E7E2D3;border-top:none;border-radius:0 0 14px 14px;color:${BRAND.text};">
        ${bodyHtml}
      </div>
    </div>`,
    text: bodyText,
  };
}

export interface TrainingReminderData {
  agentId: string;
  fullName: string;
  sentByName: string;
}

// A distinct notification from the ad-hoc "Nudge" above — that one is about
// missed daily activity; this one is a leader pointing a teammate at their
// training. No unsubscribe link for the same reason as nudgeEmail: it's a
// one-off a leader sent by hand, not a standing preference (send_training_reminder
// already rate-limits to 1/day per agent).
export function trainingReminderEmail(d: TrainingReminderData): EmailContent {
  const trainingUrl = appUrl('/today');
  const bodyHtml = `
    <p>Hello ${escapeHtml(firstName(d.fullName))},</p>
    <p>This is the reminder to attend for today's training session.</p>
    <p>It's a valuable opportunity for growth and improvement, and it will help everyone to take your business to the next level.</p>
    <p>Training is the key to growth in the Business.</p>
    <p>Kindly make sure to attend the training with your Video ON.</p>
    <p>And please take some good notes to improve your identity and to achieve highest level in the Business.\u{1F51D}</p>
    <p>Thanks!<br/>${escapeHtml(d.sentByName)}</p>
    ${button(trainingUrl, 'Open the app')}`;
  const bodyText = `Hello ${firstName(d.fullName)},\n\nThis is the reminder to attend for today's training session.\n\nIt's a valuable opportunity for growth and improvement, and it will help everyone to take your business to the next level.\n\nTraining is the key to growth in the Business.\n\nKindly make sure to attend the training with your Video ON.\n\nAnd please take some good notes to improve your identity and to achieve highest level in the Business.\u{1F51D}\n\nThanks!\n${d.sentByName}\n\nOpen the app: ${trainingUrl}`;
  return {
    subject: `${d.sentByName} sent you a training reminder`,
    html: wrap(bodyHtml, d.agentId, null),
    text: wrapText(bodyText, d.agentId, null),
  };
}

export interface RosterTrainingReminderData {
  fullName: string;
  sentByName: string;
}

// Same copy as trainingReminderEmail, standalone (no wrap/footer) because the
// recipient is a team_roster entry, not an agent -- no notification_prefs
// row, no account to manage preferences on, same reasoning as inviteEmail.
export function rosterTrainingReminderEmail(d: RosterTrainingReminderData): EmailContent {
  const bodyHtml = `
    <p>Hello ${escapeHtml(firstName(d.fullName))},</p>
    <p>This is the reminder to attend for today's training session.</p>
    <p>It's a valuable opportunity for growth and improvement, and it will help everyone to take your business to the next level.</p>
    <p>Training is the key to growth in the Business.</p>
    <p>Kindly make sure to attend the training with your Video ON.</p>
    <p>And please take some good notes to improve your identity and to achieve highest level in the Business.\u{1F51D}</p>
    <p>Thanks!<br/>${escapeHtml(d.sentByName)}</p>`;
  const bodyText = `Hello ${firstName(d.fullName)},\n\nThis is the reminder to attend for today's training session.\n\nIt's a valuable opportunity for growth and improvement, and it will help everyone to take your business to the next level.\n\nTraining is the key to growth in the Business.\n\nKindly make sure to attend the training with your Video ON.\n\nAnd please take some good notes to improve your identity and to achieve highest level in the Business.\u{1F51D}\n\nThanks!\n${d.sentByName}`;
  return {
    subject: `${d.sentByName} sent you a training reminder`,
    html: `<div style="font-family:'Plus Jakarta Sans',-apple-system,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;">
      ${header()}
      <div style="background:${BRAND.bg};padding:32px;border:1px solid #E7E2D3;border-top:none;border-radius:0 0 14px 14px;color:${BRAND.text};">
        ${bodyHtml}
      </div>
    </div>`,
    text: bodyText,
  };
}

export interface FeedbackNotificationData {
  reporterName: string;
  reporterEmail: string;
  category: string;
  subject: string;
  message: string;
  pageUrl: string | null;
}

// Sent to every admin when an agent submits the /feedback form. No
// agentId/unsubscribe footer -- this is an internal admin alert, not a
// standing per-agent notification preference. No org logo -- this goes to
// app admins, not a single org's members.
export function feedbackNotificationEmail(d: FeedbackNotificationData): EmailContent {
  const categoryLabel = d.category.replace('_', ' ');
  const pageLineHtml = d.pageUrl
    ? `<p style="font-size:12px;color:${BRAND.muted};">Page: ${escapeHtml(d.pageUrl)}</p>`
    : '';
  const pageLineText = d.pageUrl ? `\nPage: ${d.pageUrl}` : '';
  const bodyHtml = `
    <p><strong>${escapeHtml(d.reporterName)}</strong> (${escapeHtml(d.reporterEmail)}) submitted a
    <strong>${escapeHtml(categoryLabel)}</strong> report.</p>
    <p style="font-size:16px;font-weight:600;">${escapeHtml(d.subject)}</p>
    <p style="white-space:pre-wrap;">${escapeHtml(d.message)}</p>
    ${pageLineHtml}`;
  const bodyText = `${d.reporterName} (${d.reporterEmail}) submitted a ${categoryLabel} report.\n\n${d.subject}\n\n${d.message}${pageLineText}`;
  return {
    subject: `[Feedback] ${d.subject}`,
    html: `<div style="font-family:'Plus Jakarta Sans',-apple-system,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;">
      ${header()}
      <div style="background:${BRAND.bg};padding:32px;border:1px solid #E7E2D3;border-top:none;border-radius:0 0 14px 14px;color:${BRAND.text};">
        ${bodyHtml}
      </div>
    </div>`,
    text: bodyText,
  };
}

export interface NudgeData {
  agentId: string;
  fullName: string;
  sentByName: string;
  streakDays: number;
  minCallsPerDay: number;
  // Set for the automatic daily send (p12a: an SMD flips a persistent toggle
  // instead of clicking Nudge each time) -- unlike the manual one-off nudge
  // below (rate-limited to 1/day, no standing preference to unsubscribe
  // from), the recurring version needs a working one-click unsubscribe like
  // the other recurring notifications, and shares evening_nudge's own
  // preference/kind since it's the same "reminder to log calls" concept
  // from the recipient's side.
  recurring?: boolean;
}

// No unsubscribe link for the manual (non-recurring) case -- there's no
// standing preference to opt out of a one-off nudge a leader sent by hand;
// public.nudge_agent's own 1-day cooldown is the rate limit here, not
// notification_log.
export function nudgeEmail(d: NudgeData): EmailContent {
  const logUrl = appUrl('/log');
  const streakLine =
    d.streakDays > 0
      ? `${d.minCallsPerDay} calls keeps your ${d.streakDays}-day streak alive.`
      : `${d.minCallsPerDay} calls starts your streak.`;
  const bodyHtml = `
    <p>Hi ${escapeHtml(firstName(d.fullName))},</p>
    <p>${escapeHtml(d.sentByName)} noticed you haven't logged anything today. ${streakLine}</p>
    ${button(logUrl, 'Log a call')}`;
  const bodyText = `Hi ${firstName(d.fullName)},\n\n${d.sentByName} noticed you haven't logged anything today. ${streakLine}\n\nLog a call: ${logUrl}`;
  const kind: NotificationKind | null = d.recurring ? 'evening_nudge' : null;
  return {
    subject: `${d.sentByName} sent you a reminder`,
    html: wrap(bodyHtml, d.agentId, kind),
    text: wrapText(bodyText, d.agentId, kind),
    ...(kind ? { unsubscribeUrl: unsubscribeUrlFor(d.agentId, kind) } : {}),
  };
}
