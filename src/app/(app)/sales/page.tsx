import Link from 'next/link';
import { requireVerifiedAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/shell/page-header';
import { KpiCard } from '@/components/shell/kpi-card';
import { FilterBar, type FilterChip } from '@/components/shell/filter-bar';
import { resolvePeriod, todayIso, type PeriodPreset, PERIOD_PRESETS } from '@/lib/dates';
import { SaleRow } from './sale-row';

function isPeriodPreset(v: string | undefined): v is PeriodPreset {
  return !!v && (PERIOD_PRESETS as readonly string[]).includes(v);
}

// P4: filters, summary strip, sort, sticky filtered totals, CSV export (08-screen-specs.md).
export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const session = await requireVerifiedAgent();
  const supabase = await createClient();

  const today = todayIso();
  const preset: PeriodPreset = isPeriodPreset(params.period) ? params.period : 'this_week';
  const { from, to } = resolvePeriod(preset, today, params.from, params.to);
  const search = params.search?.trim() || '';
  const sort = params.sort === 'premium.desc' ? 'premium.desc' : 'date.desc';

  let query = supabase
    .from('sales')
    .select('id, sale_date, product_type, premium_cents, contacts(full_name)')
    .eq('agent_id', session.agent!.id)
    .gte('sale_date', from)
    .lte('sale_date', to);

  if (search) {
    // Resolve matching contacts first (own rows, RLS-scoped) rather than
    // filtering on the embedded resource — same pattern as /contacts.
    const { data: matches } = await supabase
      .from('contacts')
      .select('id')
      .eq('agent_id', session.agent!.id)
      .filter('full_name', 'ilike', `%${search.replace(/[%_]/g, '\\$&')}%`);
    const contactIds = (matches ?? []).map((c) => c.id);
    query = query.in('contact_id', contactIds.length ? contactIds : ['00000000-0000-0000-0000-000000000000']);
  }

  query =
    sort === 'premium.desc'
      ? query.order('premium_cents', { ascending: false })
      : query.order('sale_date', { ascending: false });

  const { data: sales } = await query;
  const rows = sales ?? [];

  const totalPremium = rows.reduce((acc, s) => acc + s.premium_cents, 0);
  const avgPremium = rows.length ? Math.round(totalPremium / rows.length) : 0;
  const largest = rows.reduce((acc, s) => Math.max(acc, s.premium_cents), 0);

  const chips: FilterChip[] = [];
  if (search) chips.push({ key: 'search', label: `"${search}"` });
  if (sort === 'premium.desc') chips.push({ key: 'sort', label: 'Sorted by premium' });

  const exportParams = new URLSearchParams({ from, to, ...(search ? { search } : {}) });

  return (
    <div className="space-y-4 max-w-3xl">
      <PageHeader
        title="Sales"
        action={
          <Button asChild variant="primary" size="sm">
            <Link href="/sales/new">Log sale</Link>
          </Button>
        }
      />

      <FilterBar preset={preset} customFrom={params.from} customTo={params.to} chips={chips}>
        <form action="/sales" className="flex items-center gap-2">
          <input type="hidden" name="period" value={preset} />
          {params.from && <input type="hidden" name="from" value={params.from} />}
          {params.to && <input type="hidden" name="to" value={params.to} />}
          <Input
            type="search"
            name="search"
            defaultValue={search}
            placeholder="Search client name…"
            className="h-9 w-48"
            aria-label="Search client name"
          />
        </form>
        <Link
          href={`/sales/export?${exportParams.toString()}`}
          className="text-xs text-acc hover:underline whitespace-nowrap"
        >
          Export CSV
        </Link>
      </FilterBar>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-fg-2">
              No sales between {from} and {to} with these filters.{' '}
              <Link href="/sales" className="text-acc hover:underline">
                Clear all
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard label="Sales" value={String(rows.length)} />
            <KpiCard label="Total premium" value={`$${(totalPremium / 100).toLocaleString('en-CA')}`} />
            <KpiCard label="Average premium" value={`$${(avgPremium / 100).toLocaleString('en-CA')}`} />
            <KpiCard label="Largest sale" value={`$${(largest / 100).toLocaleString('en-CA')}`} />
          </div>

          <div className="overflow-x-auto rounded-lg border border-line shadow-card">
            <table className="w-full text-sm">
              <thead className="bg-bg-2 text-fg-3 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left font-medium px-4 py-2.5">Date</th>
                  <th className="text-left font-medium px-4 py-2.5">Client</th>
                  <th className="text-left font-medium px-4 py-2.5">Product type</th>
                  <th className="text-left font-medium px-4 py-2.5">
                    <Link
                      href={`/sales?${new URLSearchParams({ period: preset, ...(params.from ? { from: params.from } : {}), ...(params.to ? { to: params.to } : {}), sort: sort === 'premium.desc' ? '' : 'premium.desc' }).toString()}`}
                      className="hover:text-fg"
                    >
                      Premium
                    </Link>
                  </th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <SaleRow
                    key={s.id}
                    id={s.id}
                    saleDate={s.sale_date}
                    clientName={(s.contacts as { full_name: string } | null)?.full_name ?? '—'}
                    productType={s.product_type}
                    premiumCents={s.premium_cents}
                  />
                ))}
              </tbody>
              <tfoot className="sticky bottom-0 bg-bg-2 border-t border-line-2">
                <tr>
                  <td className="px-4 py-2.5 font-medium text-fg-2" colSpan={3}>
                    Total ({rows.length} filtered)
                  </td>
                  <td className="px-4 py-2.5 font-medium font-mono tabular-nums text-ok">
                    ${(totalPremium / 100).toLocaleString('en-CA')}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
