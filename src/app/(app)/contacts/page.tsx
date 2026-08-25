import Link from 'next/link';
import { requireVerifiedAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-heading-tight text-fg">Contacts</h1>
      </div>

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
        <div className="overflow-x-auto rounded-lg border border-line">
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
      )}
    </div>
  );
}
