// Email copy for the three scheduled notifications plus the SMD's ad-hoc
// nudge (09-account-and-auth.md's Notifications table). Plain inline-styled
// HTML -- no react-email or MJML dependency (CLAUDE.md rule 10).
import { appUrl } from './app-url';
import { signUnsubscribe } from './unsubscribe-token';
import type { NotificationKind } from './window';

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

function formatMoney(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function footer(agentId: string, kind: NotificationKind | null): { html: string; text: string } {
  const settingsUrl = appUrl('/settings');
  if (!kind) {
    return {
      html: `<p style="margin-top:32px;font-size:12px;color:#888;">Manage your notification preferences at <a href="${settingsUrl}">${settingsUrl}</a>.</p>`,
      text: `Manage your notification preferences: ${settingsUrl}`,
    };
  }
  const unsubscribeUrl = appUrl(
    `/unsubscribe?agent=${encodeURIComponent(agentId)}&kind=${kind}&sig=${signUnsubscribe(agentId, kind)}`
  );
  return {
    html: `<p style="margin-top:32px;font-size:12px;color:#888;"><a href="${unsubscribeUrl}">Unsubscribe from this email</a> &middot; <a href="${settingsUrl}">Manage all notifications</a></p>`,
    text: `Unsubscribe from this email: ${unsubscribeUrl}\nManage all notifications: ${settingsUrl}`,
  };
}

function wrap(bodyHtml: string, agentId: string, kind: NotificationKind | null): EmailContent['html'] {
  const f = footer(agentId, kind);
  return `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;color:#111;">${bodyHtml}${f.html}</div>`;
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
    <p>Hi ${firstName(d.fullName)},</p>
    <p>You haven't logged any calls today. ${streakLine}</p>
    <p><a href="${logUrl}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;text-decoration:none;border-radius:6px;">Log a call</a></p>`;
  const bodyText = `Hi ${firstName(d.fullName)},\n\nYou haven't logged any calls today. ${streakLine}\n\nLog a call: ${logUrl}`;
  return {
    subject: "You haven't logged any calls today",
    html: wrap(bodyHtml, d.agentId, 'evening_nudge'),
    text: wrapText(bodyText, d.agentId, 'evening_nudge'),
  };
}

export interface SundaySummaryData {
  agentId: string;
  fullName: string;
  callsMade: number;
  callsTarget: number;
  streakDays: number;
  followUpsDueNextWeek: number;
}

export function sundaySummaryEmail(d: SundaySummaryData): EmailContent {
  const dashboardUrl = appUrl('/dashboard');
  const bodyHtml = `
    <p>Hi ${firstName(d.fullName)},</p>
    <p>Your week: <strong>${d.callsMade} of ${d.callsTarget}</strong> calls, a
    <strong>${d.streakDays}-day</strong> streak, and
    <strong>${d.followUpsDueNextWeek}</strong> follow-up${d.followUpsDueNextWeek === 1 ? '' : 's'} due next week.</p>
    <p><a href="${dashboardUrl}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;text-decoration:none;border-radius:6px;">View your dashboard</a></p>`;
  const bodyText = `Hi ${firstName(d.fullName)},\n\nYour week: ${d.callsMade} of ${d.callsTarget} calls, a ${d.streakDays}-day streak, and ${d.followUpsDueNextWeek} follow-up(s) due next week.\n\nView your dashboard: ${dashboardUrl}`;
  return {
    subject: 'Your week in review',
    html: wrap(bodyHtml, d.agentId, 'sunday_summary'),
    text: wrapText(bodyText, d.agentId, 'sunday_summary'),
  };
}

export interface MondayDigestData {
  agentId: string;
  fullName: string;
  totalCalls: number;
  totalCallsTarget: number;
  totalPremiumCents: number;
  quietAgentNames: string[];
  moverNames: string[];
}

export function mondayDigestEmail(d: MondayDigestData): EmailContent {
  const teamUrl = appUrl('/team');
  const quietLine =
    d.quietAgentNames.length > 0
      ? `Quiet this week: ${d.quietAgentNames.join(', ')}.`
      : 'Everyone logged something this week.';
  const moversLine = d.moverNames.length > 0 ? `Biggest movers: ${d.moverNames.join(', ')}.` : '';
  const bodyHtml = `
    <p>Hi ${firstName(d.fullName)},</p>
    <p>Team so far: <strong>${d.totalCalls} of ${d.totalCallsTarget}</strong> calls,
    ${formatMoney(d.totalPremiumCents)} in premium.</p>
    <p>${quietLine}${moversLine ? ` ${moversLine}` : ''}</p>
    <p><a href="${teamUrl}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;text-decoration:none;border-radius:6px;">View team dashboard</a></p>`;
  const bodyText = `Hi ${firstName(d.fullName)},\n\nTeam so far: ${d.totalCalls} of ${d.totalCallsTarget} calls, ${formatMoney(d.totalPremiumCents)} in premium.\n\n${quietLine}${moversLine ? ` ${moversLine}` : ''}\n\nView team dashboard: ${teamUrl}`;
  return {
    subject: 'Monday team digest',
    html: wrap(bodyHtml, d.agentId, 'monday_digest'),
    text: wrapText(bodyText, d.agentId, 'monday_digest'),
  };
}

export interface NudgeData {
  agentId: string;
  fullName: string;
  sentByName: string;
  streakDays: number;
  minCallsPerDay: number;
}

// No unsubscribe link -- there's no standing preference to opt out of a
// one-off nudge a leader sent by hand; public.nudge_agent's own 7-day
// cooldown is the rate limit here, not notification_log.
export function nudgeEmail(d: NudgeData): EmailContent {
  const logUrl = appUrl('/log');
  const streakLine =
    d.streakDays > 0
      ? `${d.minCallsPerDay} calls keeps your ${d.streakDays}-day streak alive.`
      : `${d.minCallsPerDay} calls starts your streak.`;
  const bodyHtml = `
    <p>Hi ${firstName(d.fullName)},</p>
    <p>${d.sentByName} noticed you haven't logged anything today. ${streakLine}</p>
    <p><a href="${logUrl}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;text-decoration:none;border-radius:6px;">Log a call</a></p>`;
  const bodyText = `Hi ${firstName(d.fullName)},\n\n${d.sentByName} noticed you haven't logged anything today. ${streakLine}\n\nLog a call: ${logUrl}`;
  return {
    subject: `${d.sentByName} sent you a reminder`,
    html: wrap(bodyHtml, d.agentId, null),
    text: wrapText(bodyText, d.agentId, null),
  };
}
