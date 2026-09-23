import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { requireVerifiedAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { todayIso } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { TodayRow } from '../today-row';
import type { DueItemKind } from '../use-follow-up-actions';

const FILTERS = [
  { key: 'today', label: 'Due today' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'all', label: 'All' },
] as const;
type Filter = (typeof FILTERS)[number]['key'];

/**
 * The follow-up queue that used to sit under "Next up" on My Day (P30). The
 * Due today / Overdue tiles link here; every row keeps its existing actions
 * (call, snooze, done, resolve an appointment) via TodayRow.
 */
export default async function DueQueuePage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const session = await requireVerifiedAgent();
  if (session.agent!.role === 'admin') redirect('/admin/agents');
  const supabase = await createClient();
  const params = await searchParams;
  const filter: Filter = FILTERS.some((f) => f.key === params.filter) ? (params.filter as Filter) : 'today';

  const { data } = await supabase.rpc('my_followups', { p_as_of: todayIso(session.agent!.time_zone) });
  const rows = (data ?? []).map((r) => ({ ...r, kind: r.kind as DueItemKind }));
  const counts = {
    today: rows.filter((r) => r.days_late === 0).length,
    overdue: rows.filter((r) => r.days_late > 0).length,
    all: rows.length,
  };
  const shown = rows.filter((r) => (filter === 'today' ? r.days_late === 0 : filter === 'overdue' ? r.days_late > 0 : true));

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div className="flex items-center gap-2">
        <Link
          href="/today"
          aria-label="Back to My Day"
          className="flex h-9 w-9 items-center justify-center rounded-sm text-fg-2 hover:bg-hover"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-[24px] font-bold tracking-heading-tight text-fg">Follow-ups</h1>
      </div>

      <nav className="flex gap-1.5" aria-label="Filter follow-ups">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={`/today/due?filter=${f.key}`}
            aria-current={f.key === filter ? 'page' : undefined}
            className={cn(
              'rounded-full border px-3 py-1.5 text-xs font-bold',
              f.key === filter ? 'border-acc bg-acc text-white' : 'border-line text-fg-2 hover:bg-hover'
            )}
          >
            {f.label} ({counts[f.key]})
          </Link>
        ))}
      </nav>

      {shown.length === 0 ? (
        <div className="rounded-lg border border-line bg-panel px-4 py-4 shadow-card">
          <p className="text-sm text-fg-3">
            {filter === 'overdue' ? 'Nothing overdue. Nice work.' : 'Nothing due today.'}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-line rounded-lg border border-line bg-panel px-4 shadow-card">
          {shown.map((row) => (
            <TodayRow
              key={`${row.kind}-${row.call_id}`}
              kind={row.kind}
              rowId={row.call_id}
              contactId={row.contact_id}
              contactName={row.contact_name}
              lastNote={row.last_note}
              timesCalled={row.times_called}
              daysLate={row.days_late}
              appointmentAt={row.appointment_at}
              timeZone={session.agent!.time_zone}
              overdue={row.days_late > 0}
            />
          ))}
        </div>
      )}
    </div>
  );
}
