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

function header(logoUrl: string | null | undefined): string {
  // An org that's uploaded its own logo gets that instead -- deliberate,
  // this is what makes the multi-tenant branding work. Everyone else gets
  // the Kautis mark next to the wordmark, not the wordmark alone. Uses the
  // pre-sized 112x112 email derivative (public/kautis-logo-email.png), not
  // the 1024x1024/~112KB master (public/kautis-logo.png) -- some email image
  // proxies (Gmail's especially) apply stricter size/thumbnailing limits to
  // inline images than a normal page load, and serving an oversized source
  // image at a 28px display size showed up as a broken icon in Gmail's own
  // hero-image card even though the URL fetched fine directly.
  const mark = logoUrl
    ? `<img src="${logoUrl}" alt="${BRAND.name}" height="28" style="height:28px;max-width:160px;display:block;" />`
    : `<img src="${appUrl('/kautis-logo-email.png')}" alt="${BRAND.name}" width="28" height="28" style="width:28px;height:28px;border-radius:50%;vertical-align:middle;display:inline-block;border:0;" /><span style="color:#fff;font-size:18px;font-weight:700;vertical-align:middle;margin-left:10px;">${BRAND.name}</span>`;
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

function wrap(
  bodyHtml: string,
  agentId: string,
  kind: NotificationKind | null,
  logoUrl?: string | null
): EmailContent['html'] {
  const f = footer(agentId, kind);
  return `<div style="font-family:'Plus Jakarta Sans',-apple-system,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;">
    ${header(logoUrl)}
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
  logoUrl?: string | null;
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
    html: wrap(bodyHtml, d.agentId, 'evening_nudge', d.logoUrl),
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
  logoUrl?: string | null;
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
    html: wrap(bodyHtml, d.agentId, 'sunday_summary', d.logoUrl),
    text: wrapText(bodyText, d.agentId, 'sunday_summary'),
    unsubscribeUrl: unsubscribeUrlFor(d.agentId, 'sunday_summary'),
  };
}

export interface CycleDigestData {
  agentId: string;
  fullName: string;
  totalCalls: number;
  totalCallsTarget: number;
  totalPremiumCents: number;
  quietAgentNames: string[];
  moverNames: string[];
  logoUrl?: string | null;
}

// Notification kind stays 'monday_digest' (the DB/URL identifier, unchanged
// since P18) even though it no longer fires on Monday -- see
// private.enqueue_due_notifications()'s doc comment for why.
export function cycleDigestEmail(d: CycleDigestData): EmailContent {
  const teamUrl = appUrl('/team');
  const quietLine =
    d.quietAgentNames.length > 0
      ? `Quiet this cycle: ${d.quietAgentNames.join(', ')}.`
      : 'Everyone logged something this cycle.';
  const moversLine = d.moverNames.length > 0 ? `Biggest movers: ${d.moverNames.join(', ')}.` : '';
  const quietLineHtml =
    d.quietAgentNames.length > 0
      ? `Quiet this cycle: ${d.quietAgentNames.map(escapeHtml).join(', ')}.`
      : 'Everyone logged something this cycle.';
  const moversLineHtml =
    d.moverNames.length > 0 ? `Biggest movers: ${d.moverNames.map(escapeHtml).join(', ')}.` : '';
  const bodyHtml = `
    <p>Hi ${escapeHtml(firstName(d.fullName))},</p>
    <p>Team so far this cycle: <strong>${d.totalCalls} of ${d.totalCallsTarget}</strong> calls,
    ${formatMoney(d.totalPremiumCents)} in premium.</p>
    <p>${quietLineHtml}${moversLineHtml ? ` ${moversLineHtml}` : ''}</p>
    ${button(teamUrl, 'View team dashboard')}`;
  const bodyText = `Hi ${firstName(d.fullName)},\n\nTeam so far this cycle: ${d.totalCalls} of ${d.totalCallsTarget} calls, ${formatMoney(d.totalPremiumCents)} in premium.\n\n${quietLine}${moversLine ? ` ${moversLine}` : ''}\n\nView team dashboard: ${teamUrl}`;
  return {
    subject: 'Your team cycle digest',
    html: wrap(bodyHtml, d.agentId, 'monday_digest', d.logoUrl),
    text: wrapText(bodyText, d.agentId, 'monday_digest'),
    unsubscribeUrl: unsubscribeUrlFor(d.agentId, 'monday_digest'),
  };
}

export interface InviteData {
  orgName: string;
  inviterName: string;
  inviteUrl: string;
  logoUrl?: string | null;
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
      ${header(d.logoUrl)}
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
      ${header(null)}
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
  logoUrl?: string | null;
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
    html: wrap(bodyHtml, d.agentId, null, d.logoUrl),
    text: wrapText(bodyText, d.agentId, null),
  };
}

export interface RosterTrainingReminderData {
  fullName: string;
  sentByName: string;
  logoUrl?: string | null;
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
      ${header(d.logoUrl)}
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
      ${header(null)}
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
  logoUrl?: string | null;
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
    html: wrap(bodyHtml, d.agentId, kind, d.logoUrl),
    text: wrapText(bodyText, d.agentId, kind),
    ...(kind ? { unsubscribeUrl: unsubscribeUrlFor(d.agentId, kind) } : {}),
  };
}
