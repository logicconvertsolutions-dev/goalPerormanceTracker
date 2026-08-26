import Link from 'next/link';
import { requireVerifiedAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/shell/page-header';
import { formatDisplayDate } from '@/lib/dates';

interface ContactRow {
  id: string;
  full_name: string;
  call_logs: { call_date: string; outcome: string; follow_up_on: string | null; follow_up_done_at: string | null }[];
}

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: { q?: string };
}) {
  const session = await requireVerifiedAgent();
  const supabase = await createClient();
  const q = searchParams.q?.trim();

  let query = supabase
    .from('contacts')
    .select('id, full_name, call_logs(call_date, outcome, follow_up_on, follow_up_done_at)')
    .eq('agent_id', session.agent!.id);

  if (q) {
    const escaped = q.replace(/[%_]/g, '\\$&');
    query = query.ilike('full_name', `%${escaped}%`);
  }

  const { data: contacts } = await query
    .order('full_name', { ascending: true })
    .returns<ContactRow[]>();
  const rows = contacts ?? [];

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader title="Contacts" />

      <form className="max-w-sm">
        <Input name="q" defaultValue={q ?? ''} placeholder="Search name" />
      </form>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-fg-2">
              {q
                ? `No contacts matching "${q}".`
                : 'No contacts yet. They appear automatically when you log a call.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Mobile: a divided list, same visual language as My Day's Recent
              Activity — a table's horizontal scroll doesn't work well on a
              small screen. */}
          <div className="divide-y divide-line rounded-lg border border-line bg-panel px-4 shadow-card md:hidden">
            {rows.map((c) => {
              const calls = [...c.call_logs].sort((a, b) => (a.call_date < b.call_date ? 1 : -1));
              const last = calls[0];
              const nextFollowUp = c.call_logs
                .filter((cl) => cl.follow_up_on && !cl.follow_up_done_at)
                .sort((a, b) => (a.follow_up_on! < b.follow_up_on! ? -1 : 1))[0]?.follow_up_on;

              return (
                <Link key={c.id} href={`/contacts/${c.id}`} className="block py-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-[15px] font-semibold text-fg">{c.full_name}</p>
                    <span className="shrink-0 text-xs text-fg-3">{calls.length} calls</span>
                  </div>
                  <p className="mt-0.5 truncate text-sm text-fg-3">
                    {last
                      ? `${formatDisplayDate(last.call_date)} · ${last.outcome.replace('_', ' ')}`
                      : 'No calls yet'}
                    {nextFollowUp && ` · Follow-up ${formatDisplayDate(nextFollowUp)}`}
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
                  <th className="text-left font-medium px-4 py-2.5">Contact</th>
                  <th className="text-left font-medium px-4 py-2.5">Times called</th>
                  <th className="text-left font-medium px-4 py-2.5">Last called</th>
                  <th className="text-left font-medium px-4 py-2.5">Last outcome</th>
                  <th className="text-left font-medium px-4 py-2.5">Next follow-up</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const calls = [...c.call_logs].sort((a, b) => (a.call_date < b.call_date ? 1 : -1));
                  const last = calls[0];
                  const nextFollowUp = c.call_logs
                    .filter((cl) => cl.follow_up_on && !cl.follow_up_done_at)
                    .sort((a, b) => (a.follow_up_on! < b.follow_up_on! ? -1 : 1))[0]?.follow_up_on;

                  return (
                    <tr key={c.id} className="border-t border-line hover:bg-hover">
                      <td className="px-4 py-2.5">
                        <Link href={`/contacts/${c.id}`} className="text-fg font-medium hover:underline">
                          {c.full_name}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-fg-2">{calls.length}</td>
                      <td className="px-4 py-2.5 text-fg-2">
                        {last ? formatDisplayDate(last.call_date) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-fg-2">
                        {last ? last.outcome.replace('_', ' ') : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-fg-2">
                        {nextFollowUp ? formatDisplayDate(nextFollowUp) : '—'}
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
