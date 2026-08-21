import { requireAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';

// "Download everything" (09-account-and-auth.md /settings "Your data"):
// JSON of every row this agent owns. RLS already scopes every one of
// these tables to `agent_id = auth.uid()`, so no extra filtering needed
// here -- the same query shape as every other screen, just unfiltered by
// date and returned whole rather than rendered.
export async function GET() {
  const session = await requireAgent();
  const supabase = await createClient();
  const agentId = session.agent!.id;

  const [profile, contacts, callLogs, appointments, sales, recruitingLogs, dailyMetrics] =
    await Promise.all([
      supabase
        .from('agents')
        .select('full_name, email, role, joined_at, time_zone')
        .eq('id', agentId)
        .single(),
      supabase.from('contacts').select('*').eq('agent_id', agentId),
      supabase.from('call_logs').select('*').eq('agent_id', agentId),
      supabase.from('appointments').select('*').eq('agent_id', agentId),
      supabase.from('sales').select('*').eq('agent_id', agentId),
      supabase.from('recruiting_logs').select('*').eq('agent_id', agentId),
      supabase.from('daily_metrics').select('*').eq('agent_id', agentId),
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
  };

  return new Response(JSON.stringify(bundle, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="my-data-${session.agent!.id}.json"`,
    },
  });
}
