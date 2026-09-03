import { NextRequest } from 'next/server';
import { requireAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { formatDisplayDate, resolvePeriod, todayIso, type PeriodPreset, PERIOD_PRESETS } from '@/lib/dates';

function isPeriodPreset(v: string | null): v is PeriodPreset {
  return !!v && (PERIOD_PRESETS as readonly string[]).includes(v);
}

function csvField(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// CSV export of the filtered set, re-running the same query server-side so
// it reflects the true filtered set rather than whatever happened to be
// rendered client-side (08-screen-specs.md: "/sales ... CSV export").
export async function GET(request: NextRequest) {
  const session = await requireAgent();
  const supabase = await createClient();
  const url = new URL(request.url);

  const today = todayIso(session.agent!.time_zone);
  const preset: PeriodPreset = isPeriodPreset(url.searchParams.get('period')) ? (url.searchParams.get('period') as PeriodPreset) : 'this_week';
  const { from, to } = resolvePeriod(
    preset,
    today,
    url.searchParams.get('from') ?? undefined,
    url.searchParams.get('to') ?? undefined
  );
  const search = url.searchParams.get('search')?.trim() || '';

  let query = supabase
    .from('sales')
    .select('sale_date, product_type, premium_cents, contacts(full_name)')
    .eq('agent_id', session.agent!.id)
    .gte('sale_date', from)
    .lte('sale_date', to);

  if (search) {
    const { data: matches } = await supabase
      .from('contacts')
      .select('id')
      .eq('agent_id', session.agent!.id)
      .filter('full_name', 'ilike', `%${search.replace(/[%_]/g, '\\$&')}%`);
    const contactIds = (matches ?? []).map((c) => c.id);
    query = query.in('contact_id', contactIds.length ? contactIds : ['00000000-0000-0000-0000-000000000000']);
  }

  const { data: sales } = await query.order('sale_date', { ascending: false });
  const rows = sales ?? [];

  const header = ['Date', 'Client', 'Product Type', 'Premium'].join(',');
  const lines = rows.map((s) =>
    [
      csvField(formatDisplayDate(s.sale_date)),
      csvField((s.contacts as { full_name: string } | null)?.full_name ?? ''),
      csvField(s.product_type ?? ''),
      csvField((s.premium_cents / 100).toFixed(2)),
    ].join(',')
  );
  const csv = [header, ...lines].join('\r\n');

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="sales-${from}-to-${to}.csv"`,
    },
  });
}
