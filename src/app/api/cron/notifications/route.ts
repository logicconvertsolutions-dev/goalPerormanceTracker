import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { composeNudge } from '@/lib/notifications/compose';
import { sendEmail } from '@/lib/notifications/send';
import { rosterTrainingReminderEmail, type EmailContent } from '@/lib/notifications/templates';
import { isRosterReminderWindow, kindsInWindow, localParts, resolveTimeZone } from '@/lib/notifications/window';

export const dynamic = 'force-dynamic';

// Invoked by pg_cron's `ping-legacy-notifications` job (private.
// ping_legacy_notifications(), every 5 minutes, via pg_net) -- see
// 20260905090000_p14a_bulk_notification_pipeline.sql. Previously triggered
// by a GitHub Actions `schedule:` workflow; that workflow is deleted and
// GitHub Actions is no longer involved in scheduling anything in this
// product -- every cron-shaped job now lives in Postgres via pg_cron,
// alongside the daily_metrics pipeline's own three jobs, so there's one
// place to look, one place to maintain, and no dependency on a scheduler
// (GitHub's) that's explicitly documented as best-effort.
//
// P14a moved the three per-agent kinds (evening_nudge, sunday_summary,
// monday_digest) off this route entirely -- they're now driven by
// pg_cron's `enqueue-due-notifications` (pure SQL, private.
// enqueue_due_notifications()) and drained by /api/cron/notifications/drain,
// because that per-agent path is the one that scales with total user count
// and needed a bounded-batch send path, not just a different trigger.
//
// What's left here -- team_roster's Wed/Sat auto-reminders (p11a) and the
// SMD's opt-in auto_call_nudges (p12a) -- deliberately stays on this
// simpler, request-per-tick path: both are bounded by a much smaller set
// (a roster an SMD manually built, or agents explicitly opted into
// auto-nudging) that won't hit the thousands-of-recipients wall the P14a
// pipeline exists to solve, so moving them onto the queue wasn't worth the
// added complexity. Their own eligibility windows (window.ts) were widened
// the same self-healing way as the per-agent path's, though, since a late
// or skipped pg_cron tick -- while far less likely than GitHub Actions
// ever was -- isn't literally impossible.
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

  const [rosterSent, autoNudgeSent] = await Promise.all([
    sendDueRosterReminders(admin, now),
    sendDueAutoCallNudges(admin, now),
  ]);

  return NextResponse.json({ rosterSent, autoNudgeSent });
}

// SMD-triggered daily "log your calls" reminder (p12a) -- distinct from
// nudge_agent (manual, rate-limited) -- a leader/admin flips
// auto_call_nudges_enabled on for a quiet associate and this fires every
// weekday evening from then on, no further clicks required. Reuses
// evening_nudge's own 7pm-local/weekday window via kindsInWindow rather than
// re-deriving it, and skips anyone who already has activity logged today or
// already received the plain evening_nudge email today (checked directly
// against notification_log, which P14a's enqueue function now writes to --
// this still works correctly since it's a fresh read of the table, not
// dependent on running in the same request as that write).
async function sendDueAutoCallNudges(
  admin: ReturnType<typeof createAdminClient>,
  now: Date
): Promise<number> {
  const { data: agents } = await admin
    .from('agents')
    .select('id, email, full_name, time_zone, upline_id')
    .eq('status', 'active')
    .eq('role', 'associate')
    .eq('auto_call_nudges_enabled', true);
  if (!agents || agents.length === 0) return 0;

  const { data: allPrefs } = await admin.from('notification_prefs').select('agent_id, evening_nudge');
  const prefsByAgent = new Map((allPrefs ?? []).map((p) => [p.agent_id, p]));

  const dueAgents = agents
    .filter((a) => (prefsByAgent.get(a.id)?.evening_nudge ?? true))
    .filter((a) => kindsInWindow(localParts(resolveTimeZone(a.time_zone), now)).includes('evening_nudge'));
  if (dueAgents.length === 0) return 0;

  const localDateByAgent = new Map(
    dueAgents.map((a) => [a.id, localParts(resolveTimeZone(a.time_zone), now).dateIso])
  );
  const dates = Array.from(new Set(localDateByAgent.values()));
  const agentIds = dueAgents.map((a) => a.id);

  const [{ data: metricsRows }, { data: eveningLog }] = await Promise.all([
    admin
      .from('daily_metrics')
      .select('agent_id, activity_date, calls_made, appts_set, sales_count, recruiting_convos')
      .in('agent_id', agentIds)
      .in('activity_date', dates),
    admin
      .from('notification_log')
      .select('agent_id, local_date')
      .eq('kind', 'evening_nudge')
      .in('agent_id', agentIds)
      .in('local_date', dates),
  ]);

  const loggedToday = new Set(
    (metricsRows ?? [])
      .filter(
        (r) =>
          localDateByAgent.get(r.agent_id) === r.activity_date &&
          (r.calls_made > 0 || r.appts_set > 0 || r.sales_count > 0 || r.recruiting_convos > 0)
      )
      .map((r) => r.agent_id)
  );
  const alreadyGotEveningEmail = new Set(
    (eveningLog ?? [])
      .filter((r) => localDateByAgent.get(r.agent_id) === r.local_date)
      .map((r) => r.agent_id)
  );

  const uplineIds = Array.from(new Set(dueAgents.map((a) => a.upline_id).filter((id): id is string => !!id)));
  const { data: uplines } = await admin.from('agents').select('id, full_name').in('id', uplineIds);
  const uplineNameById = new Map((uplines ?? []).map((u) => [u.id, u.full_name]));

  let sent = 0;
  for (const agent of dueAgents) {
    if (loggedToday.has(agent.id) || alreadyGotEveningEmail.has(agent.id)) continue;
    const localDateIso = localDateByAgent.get(agent.id)!;

    // Insert-first, same rate-limit-via-unique-index shape as notification_log.
    const { error: insertError } = await admin
      .from('agent_auto_nudge_log')
      .insert({ agent_id: agent.id, local_date: localDateIso });
    if (insertError) continue;

    try {
      const sentByName = (agent.upline_id && uplineNameById.get(agent.upline_id)) || 'Your SMD';
      const composed = await composeNudge(admin, agent, sentByName, true);
      if (composed) {
        await sendEmail({
          to: composed.to,
          subject: composed.content.subject,
          html: composed.content.html,
          text: composed.content.text,
          unsubscribeUrl: composed.content.unsubscribeUrl,
        });
        sent += 1;
      }
    } catch (err) {
      console.error(`[notifications] failed to send auto nudge to ${agent.id}`, err);
    }
  }
  return sent;
}

// team_roster's automatic Wed/Sat reminder (p11a) -- independent of the
// per-agent pass: a roster entry isn't an agent (no role, no prefs, no own
// time_zone), so it doesn't fit agentsDueNow/kindsInWindow. Resolved against
// the roster's upline's time zone since that's the closest "whose local
// time" concept a login-less roster row has.
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
      const content: EmailContent = rosterTrainingReminderEmail({
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
