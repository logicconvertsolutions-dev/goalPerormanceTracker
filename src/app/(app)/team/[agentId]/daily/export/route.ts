import { NextRequest } from 'next/server';
import { requireLeader } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { formatDisplayDate, resolvePeriod, todayIso, type PeriodPreset, PERIOD_PRESETS } from '@/lib/dates';

function isPeriodPreset(v: string | null): v is PeriodPreset {
  return !!v && (PERIOD_PRESETS as readonly string[]).includes(v);
}

function csvField(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// CSV export of one agent's daily grid (08-screen-specs.md: "/team ... CSV
// export of ... a single agent's daily grid"). Counts only, via
// agent_daily_activity — same is_upline_of gate as the on-screen grid.
export async function GET(request: NextRequest, { params }: { params: { agentId: string } }) {
  await requireLeader();
  const supabase = await createClient();
  const url = new URL(request.url);
  const agentId = params.agentId;

  const { data: agent } = await supabase
    .from('agents')
    .select('full_name')
    .eq('id', agentId)
    .maybeSingle();
  if (!agent) {
    return new Response('Not found', { status: 404 });
  }

  const today = todayIso();
  const preset: PeriodPreset = isPeriodPreset(url.searchParams.get('period'))
    ? (url.searchParams.get('period') as PeriodPreset)
    : 'this_week';
  const { from, to } = resolvePeriod(
    preset,
    today,
    url.searchParams.get('from') ?? undefined,
    url.searchParams.get('to') ?? undefined
  );

  const { data: activity } = await supabase.rpc('agent_daily_activity', {
    p_agent_id: agentId,
    p_from: from,
    p_to: to,
  });
  const rows = activity ?? [];

  const header = ['Date', 'Calls Made', 'Min Calls Target', 'Min Met', 'Appts Set', 'Appts Held', 'Premium'].join(',');
  const lines = rows.map((r) =>
    [
      csvField(formatDisplayDate(r.activity_date)),
      csvField(r.calls_made),
      csvField(r.min_calls_target),
      csvField(r.min_met ? 'Yes' : 'No'),
      csvField(r.appts_set),
      csvField(r.appts_held),
      csvField((r.premium_cents / 100).toFixed(2)),
    ].join(',')
  );
  const csv = [header, ...lines].join('\r\n');

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${agent.full_name.replace(/[^a-z0-9]+/gi, '-')}-daily-${from}-to-${to}.csv"`,
    },
  });
}
