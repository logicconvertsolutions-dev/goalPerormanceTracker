import { requireAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';

// "Download everything" (09-account-and-auth.md /settings "Your data"):
// JSON of every row this agent owns. RLS already scopes every one of
// these tables to `agent_id = auth.uid()`, so no extra filtering needed
// here -- the same query shape as every other screen, just unfiltered by
// date and returned whole rather than rendered.
//
// P33: this is the PIPEDA right-of-access answer, so it has to be
// everything held about the agent, not just the activity tables -- to-dos,
// reminders, the bell, notification settings, registered push devices and
// feedback were added. Push subscription keys are left out: they are
// credentials for delivering to the device, not information about the person.
export async function GET() {
  const session = await requireAgent();
  const supabase = await createClient();
  const agentId = session.agent!.id;

  const [
    profile,
    contacts,
    callLogs,
    appointments,
    sales,
    recruitingLogs,
    dailyMetrics,
    tasks,
    reminders,
    notifications,
    notificationPrefs,
    pushDevices,
    feedback,
    pendingCalls,
  ] = await Promise.all([
      supabase
        .from('agents')
        .select('full_name, email, role, joined_at, time_zone, terms_accepted_at')
        .eq('id', agentId)
        .single(),
      supabase.from('contacts').select('*').eq('agent_id', agentId),
      supabase.from('call_logs').select('*').eq('agent_id', agentId),
      supabase.from('appointments').select('*').eq('agent_id', agentId),
      supabase.from('sales').select('*').eq('agent_id', agentId),
      supabase.from('recruiting_logs').select('*').eq('agent_id', agentId),
      supabase.from('daily_metrics').select('*').eq('agent_id', agentId),
      supabase.from('tasks').select('*').eq('agent_id', agentId),
      supabase.from('reminders').select('*').eq('agent_id', agentId),
      supabase.from('notifications').select('*').eq('agent_id', agentId),
      supabase.from('notification_prefs').select('*').eq('agent_id', agentId).maybeSingle(),
      supabase
        .from('push_subscriptions')
        .select('id, user_agent, created_at, last_seen_at')
        .eq('agent_id', agentId),
      supabase.from('feedback').select('*').eq('agent_id', agentId),
      supabase.from('pending_calls').select('*').eq('agent_id', agentId),
    ]);

  const bundle = {
    exported_at: new Date().toISOString(),
    profile: profile.data,
    contacts: contacts.data ?? [],
    call_logs: callLogs.data ?? [],
    appointments: appointments.data ?? [],
    sales: sales.data ?? [],
    recruiting_logs: recruitingLogs.data ?? [],
    daily_metrics: dailyMetrics.data ?? [],
    tasks: tasks.data ?? [],
    reminders: reminders.data ?? [],
    notifications: notifications.data ?? [],
    notification_settings: notificationPrefs.data,
    push_devices: pushDevices.data ?? [],
    feedback: feedback.data ?? [],
    calls_to_finish: pendingCalls.data ?? [],
  };

  return new Response(JSON.stringify(bundle, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="my-data-${session.agent!.id}.json"`,
    },
  });
}
