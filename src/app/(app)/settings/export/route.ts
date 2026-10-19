import { requireAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { fetchAllPages } from '@/lib/supabase/fetch-all';

type AgentTable =
  | 'contacts'
  | 'call_logs'
  | 'appointments'
  | 'sales'
  | 'recruiting_logs'
  | 'daily_metrics'
  | 'tasks'
  | 'reminders'
  | 'notifications'
  | 'push_subscriptions'
  | 'feedback'
  | 'pending_calls';

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

  // Every multi-row table is read through fetchAllPages: a plain select stops
  // silently at max_rows (1000), and a right-of-access export that quietly
  // drops an agent's 1,001st contact is worse than one that fails loudly.
  const all = <T,>(table: AgentTable, columns = '*', orderBy = 'id') =>
    fetchAllPages<T>((from, to) =>
      supabase
        .from(table)
        .select(columns)
        .eq('agent_id', agentId)
        .order(orderBy, { ascending: true })
        .range(from, to)
        .returns<T[]>()
    );

  let results;
  try {
    results = await Promise.all([
      supabase
        .from('agents')
        .select('full_name, email, role, joined_at, time_zone, terms_accepted_at')
        .eq('id', agentId)
        .single(),
      all('contacts'),
      all('call_logs'),
      all('appointments'),
      all('sales'),
      all('recruiting_logs'),
      // Keyed (agent_id, activity_date) -- no id column.
      all('daily_metrics', '*', 'activity_date'),
      all('tasks'),
      all('reminders'),
      all('notifications'),
      supabase.from('notification_prefs').select('*').eq('agent_id', agentId).maybeSingle(),
      all('push_subscriptions', 'id, user_agent, created_at, last_seen_at'),
      all('feedback'),
      all('pending_calls'),
    ]);
  } catch (e) {
    console.error('[settings/export] read failed', e);
    return new Response('Could not export your data right now -- try again.', { status: 500 });
  }
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
  ] = results;

  const bundle = {
    exported_at: new Date().toISOString(),
    profile: profile.data,
    contacts,
    call_logs: callLogs,
    appointments,
    sales,
    recruiting_logs: recruitingLogs,
    daily_metrics: dailyMetrics,
    tasks,
    reminders,
    notifications,
    notification_settings: notificationPrefs.data,
    push_devices: pushDevices,
    feedback,
    calls_to_finish: pendingCalls,
  };

  return new Response(JSON.stringify(bundle, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="my-data-${session.agent!.id}.json"`,
    },
  });
}
