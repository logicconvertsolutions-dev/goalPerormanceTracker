import { NextRequest } from 'next/server';
import { requireLeader } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { resolvePeriod, todayIso, type PeriodPreset, PERIOD_PRESETS } from '@/lib/dates';

function isPeriodPreset(v: string | null): v is PeriodPreset {
  return !!v && (PERIOD_PRESETS as readonly string[]).includes(v);
}

function csvField(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// CSV export of the roster, re-running team_period_summary server-side so it
// reflects the true filtered period rather than whatever happened to be
// rendered client-side (08-screen-specs.md: "/team ... CSV export of the roster").
export async function GET(request: NextRequest) {
  await requireLeader();
  const supabase = await createClient();
  const url = new URL(request.url);

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

  const { data: roster } = await supabase.rpc('team_period_summary', { p_from: from, p_to: to });
  const rows = roster ?? [];

  const header = [
    'Agent',
    'Calls',
    'Calls Target',
    'Appts Set',
    'Appts Held',
    'Appts Held Target',
    'Premium',
    'Premium Target',
    'Streak (days)',
    'Last Logged',
    'Has Override',
  ].join(',');
  const lines = rows.map((r) =>
    [
      csvField(r.full_name),
      csvField(r.calls_made),
      csvField(r.calls_target),
      csvField(r.appts_set),
      csvField(r.appts_held),
      csvField(r.appts_held_target),
      csvField((r.premium_cents / 100).toFixed(2)),
      csvField((Number(r.premium_cents_target) / 100).toFixed(2)),
      csvField(r.streak_days),
      csvField(r.last_logged_at ?? ''),
      csvField(r.has_override ? 'Yes' : 'No'),
    ].join(',')
  );
  const csv = [header, ...lines].join('\r\n');

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="team-roster-${from}-to-${to}.csv"`,
    },
  });
}
