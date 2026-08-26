import Link from 'next/link';
import { requireVerifiedAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/shell/page-header';
import { formatDisplayDate } from '@/lib/dates';

interface ClientRow {
  id: string;
  full_name: string;
  phone: string | null;
  sales: { sale_date: string; premium_cents: number }[];
}

/**
 * A "client" isn't a separate entity — it's any contact with at least one
 * recorded sale (`sales!inner` below makes that the join condition). No new
 * schema: this page is a filtered, sale-aggregated view over `contacts`.
 */
export default async function ClientsPage({
  searchParams,
}: {
  searchParams: { q?: string };
}) {
  const session = await requireVerifiedAgent();
  const supabase = await createClient();
  const q = searchParams.q?.trim();

  let query = supabase
    .from('contacts')
    .select('id, full_name, phone, sales!inner(sale_date, premium_cents)')
    .eq('agent_id', session.agent!.id);

  if (q) {
    const escaped = q.replace(/[%_]/g, '\\$&');
    query = query.ilike('full_name', `%${escaped}%`);
  }

  const { data: clients } = await query
    .order('full_name', { ascending: true })
    .returns<ClientRow[]>();
  const rows = clients ?? [];

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader title="Clients" subtitle="Contacts with at least one recorded sale" />

      <form className="max-w-sm">
        <Input name="q" defaultValue={q ?? ''} placeholder="Search name" />
      </form>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-fg-2">
              {q ? `No clients matching "${q}".` : 'No clients yet. They appear here once a sale is logged.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Mobile: a divided list, same pattern as Contacts. */}
          <div className="divide-y divide-line rounded-lg border border-line bg-panel px-4 shadow-card md:hidden">
            {rows.map((c) => {
              const totalCents = c.sales.reduce((sum, s) => sum + s.premium_cents, 0);
              const mostRecent = [...c.sales].sort((a, b) => (a.sale_date < b.sale_date ? 1 : -1))[0];
              return (
                <Link key={c.id} href={`/contacts/${c.id}`} className="block py-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-[15px] font-semibold text-fg">{c.full_name}</p>
                    <span className="shrink-0 text-xs font-medium text-ok">
                      ${(totalCents / 100).toLocaleString('en-CA')}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-sm text-fg-3">
                    {c.sales.length} sale{c.sales.length === 1 ? '' : 's'}
                    {mostRecent && ` · last ${formatDisplayDate(mostRecent.sale_date)}`}
                  </p>
                </Link>
              );
            })}
          </div>

          {/* Desktop / tablet: full table. */}
          <div className="hidden overflow-x-auto rounded-lg border border-line shadow-card md:block">
            <table className="w-full text-sm">
              <thead className="bg-bg-2 text-fg-3 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left font-medium px-4 py-2.5">Client</th>
                  <th className="text-left font-medium px-4 py-2.5">Phone</th>
                  <th className="text-left font-medium px-4 py-2.5">Sales</th>
                  <th className="text-left font-medium px-4 py-2.5">Last sale</th>
                  <th className="text-right font-medium px-4 py-2.5">Total premium</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const totalCents = c.sales.reduce((sum, s) => sum + s.premium_cents, 0);
                  const mostRecent = [...c.sales].sort((a, b) => (a.sale_date < b.sale_date ? 1 : -1))[0];
                  return (
                    <tr key={c.id} className="border-t border-line hover:bg-hover">
                      <td className="px-4 py-2.5">
                        <Link href={`/contacts/${c.id}`} className="text-fg font-medium hover:underline">
                          {c.full_name}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-fg-2">{c.phone ?? '—'}</td>
                      <td className="px-4 py-2.5 text-fg-2">{c.sales.length}</td>
                      <td className="px-4 py-2.5 text-fg-2">
                        {mostRecent ? formatDisplayDate(mostRecent.sale_date) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium text-ok">
                        ${(totalCents / 100).toLocaleString('en-CA')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
