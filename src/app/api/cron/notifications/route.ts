import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { agentsDueNow, type AgentForEligibility } from '@/lib/notifications/eligibility';
import { composeEveningNudge, composeSundaySummary, composeMondayDigest } from '@/lib/notifications/compose';
import { sendEmail } from '@/lib/notifications/send';
import { rosterTrainingReminderEmail, type EmailContent } from '@/lib/notifications/templates';
import { isRosterReminderWindow, localParts, resolveTimeZone } from '@/lib/notifications/window';

export const dynamic = 'force-dynamic';

// Invoked every 15 minutes by .github/workflows/notifications-cron.yml
// (Vercel Hobby only allows once-a-day cron, too coarse for per-agent local
// send windows -- see window.ts). That workflow sends
// `Authorization: Bearer ${CRON_SECRET}`, which also doubles as the auth
// check keeping this route from being a public trigger for arbitrary email
// sends.
function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // no secret configured (local dev) -- don't lock developers out
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const now = new Date();

  // team_roster's Wed/Sat reminder pass is independent of the per-agent
  // notifications below -- it must run on every invocation, not only the
  // (much rarer) ticks where some agent also happens to be in a send
  // window right now, so it's kicked off before either early return.
  const rosterSentPromise = sendDueRosterReminders(admin, now);

  const [{ data: agents }, { data: allPrefs }] = await Promise.all([
    admin.from('agents').select('id, email, full_name, role, time_zone').eq('status', 'active'),
    admin.from('notification_prefs').select('agent_id, evening_nudge, sunday_summary, monday_digest'),
  ]);
  if (!agents || agents.length === 0) {
    return NextResponse.json({ sent: 0, candidates: 0, rosterSent: await rosterSentPromise });
  }

  const prefsByAgent = new Map((allPrefs ?? []).map((p) => [p.agent_id, p]));
  const eligibilityAgents: AgentForEligibility[] = agents.map((a) => {
    const p = prefsByAgent.get(a.id);
    return {
      agentId: a.id,
      role: a.role,
      timeZone: a.time_zone,
      prefs: {
        eveningNudge: p?.evening_nudge ?? true,
        sundaySummary: p?.sunday_summary ?? true,
        mondayDigest: p?.monday_digest ?? true,
      },
    };
  });

  // Pass 1: who's in their local send window right now, ignoring the two
  // checks that need extra queries (already sent, already logged) -- that
  // tells us exactly which notification_log / daily_metrics rows to fetch.
  const windowMatches = agentsDueNow({
    agents: eligibilityAgents,
    now,
    alreadySent: new Set(),
    loggedToday: new Set(),
  });
  if (windowMatches.length === 0) {
    return NextResponse.json({ sent: 0, candidates: 0, rosterSent: await rosterSentPromise });
  }

  const candidateAgentIds = Array.from(new Set(windowMatches.map((m) => m.agentId)));
  const candidateKinds = Array.from(new Set(windowMatches.map((m) => m.kind)));
  const candidateDates = Array.from(new Set(windowMatches.map((m) => m.localDateIso)));

  const { data: existingLog } = await admin
    .from('notification_log')
    .select('agent_id, kind, local_date')
    .in('agent_id', candidateAgentIds)
    .in('kind', candidateKinds)
    .in('local_date', candidateDates);
  const alreadySent = new Set((existingLog ?? []).map((r) => `${r.agent_id}:${r.kind}:${r.local_date}`));

  const eveningCandidateIds = windowMatches
    .filter((m) => m.kind === 'evening_nudge')
    .map((m) => m.agentId);
  const loggedToday = new Set<string>();
  if (eveningCandidateIds.length > 0) {
    const { data: metricsRows } = await admin
      .from('daily_metrics')
      .select('agent_id, activity_date, calls_made, appts_set, sales_count, recruiting_convos')
      .in('agent_id', eveningCandidateIds)
      .in('activity_date', candidateDates);
    for (const row of metricsRows ?? []) {
      const isMatch = windowMatches.some(
        (m) => m.kind === 'evening_nudge' && m.agentId === row.agent_id && m.localDateIso === row.activity_date
      );
      if (!isMatch) continue;
      const hasActivity =
        row.calls_made > 0 || row.appts_set > 0 || row.sales_count > 0 || row.recruiting_convos > 0;
      if (hasActivity) loggedToday.add(row.agent_id);
    }
  }

  // Pass 2: the authoritative due list, now that alreadySent/loggedToday are known.
  const due = agentsDueNow({ agents: eligibilityAgents, now, alreadySent, loggedToday });

  const agentById = new Map(agents.map((a) => [a.id, a]));
  let sent = 0;

  for (const item of due) {
    // Insert-first: the unique (agent_id, kind, local_date) index is the
    // real rate limit. Losing this race means a concurrent invocation
    // already claimed the slot -- skip, don't double-send.
    const { error: insertError } = await admin
      .from('notification_log')
      .insert({ agent_id: item.agentId, kind: item.kind, local_date: item.localDateIso });
    if (insertError) continue;

    const agent = agentById.get(item.agentId);
    if (!agent) continue;

    try {
      let composed: { to: string; content: EmailContent } | null = null;
      if (item.kind === 'evening_nudge') {
        composed = await composeEveningNudge(admin, agent, item.localDateIso);
      } else if (item.kind === 'sunday_summary') {
        composed = await composeSundaySummary(admin, agent, item.localDateIso);
      } else {
        composed = await composeMondayDigest(admin, agent, item.localDateIso);
      }
      if (composed) {
        await sendEmail({
          to: composed.to,
          subject: composed.content.subject,
          html: composed.content.html,
          text: composed.content.text,
        });
        sent += 1;
      }
    } catch (err) {
      console.error(`[notifications] failed to send ${item.kind} to ${item.agentId}`, err);
    }
  }

  return NextResponse.json({ sent, candidates: due.length, rosterSent: await rosterSentPromise });
}

// team_roster's automatic Wed/Sat reminder (p11a) -- independent of the
// per-agent pass above: a roster entry isn't an agent (no role, no prefs,
// no own time_zone), so it doesn't fit agentsDueNow/kindsInWindow. Resolved
// against the roster's upline's time zone since that's the closest "whose
// local time" concept a login-less roster row has.
async function sendDueRosterReminders(
  admin: ReturnType<typeof createAdminClient>,
  now: Date
): Promise<number> {
  const { data: roster } = await admin
    .from('team_roster')
    .select('id, full_name, email, upline_id')
    .eq('auto_reminders_enabled', true)
    .not('email', 'is', null);
  if (!roster || roster.length === 0) return 0;

  const uplineIds = Array.from(new Set(roster.map((r) => r.upline_id)));
  const { data: uplines } = await admin.from('agents').select('id, full_name, time_zone').in('id', uplineIds);
  const uplineById = new Map((uplines ?? []).map((u) => [u.id, u]));

  let sent = 0;
  for (const member of roster) {
    if (!member.email) continue;
    const upline = uplineById.get(member.upline_id);
    const parts = localParts(resolveTimeZone(upline?.time_zone), now);
    if (!isRosterReminderWindow(parts)) continue;

    // Insert-first, same rate-limit-via-unique-index shape as notification_log.
    const { error: insertError } = await admin
      .from('team_roster_reminder_log')
      .insert({ roster_id: member.id, local_date: parts.dateIso });
    if (insertError) continue;

    try {
      const content = rosterTrainingReminderEmail({
        fullName: member.full_name,
        sentByName: upline?.full_name ?? 'Your SMD',
      });
      await sendEmail({ to: member.email, subject: content.subject, html: content.html, text: content.text });
      sent += 1;
    } catch (err) {
      console.error(`[notifications] failed to send roster reminder to ${member.id}`, err);
    }
  }
  return sent;
}
