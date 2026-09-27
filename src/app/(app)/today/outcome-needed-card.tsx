import Link from 'next/link';
import { MessageCircle, Phone, ChevronRight } from 'lucide-react';
import { formatDisplayDate } from '@/lib/dates';
import { withReturnTo } from '@/lib/return-to';

export interface OutcomeNeededCall {
  id: string;
  call_date: string;
  channel: string | null;
  contacts: { full_name: string } | null;
}

/**
 * "Calls needing an outcome" (P34): tap-to-call attempts the agent closed
 * the post-call prompt on without answering. Each row opens the call to
 * fill in; the card disappears once there are none. They already count as
 * calls made -- this is about the outcome, not the count.
 */
export function OutcomeNeededCard({ calls, total }: { calls: OutcomeNeededCall[]; total: number }) {
  if (total === 0) return null;
  return (
    <section
      className="rounded-lg border border-warn/40 bg-warn-dim/40 p-4 shadow-card"
      aria-label="Calls needing an outcome"
    >
      <h2 className="text-[15px] font-bold text-fg">
        {total === 1 ? '1 call needs an outcome' : `${total} calls need an outcome`}
      </h2>
      <p className="text-xs text-fg-2">How did they go? It takes a few seconds each.</p>
      <ul className="mt-2 divide-y divide-line">
        {calls.map((c) => {
          const Icon = c.channel === 'whatsapp' ? MessageCircle : Phone;
          return (
            <li key={c.id}>
              <Link
                href={withReturnTo(`/log/${c.id}/edit`, '/today')}
                className="flex items-center gap-3 py-2.5 hover:bg-hover/60"
              >
                <Icon className="h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-fg">
                    {c.contacts?.full_name ?? 'Contact'}
                  </span>
                  <span className="block text-xs text-fg-3">
                    {formatDisplayDate(c.call_date)} · {c.channel === 'whatsapp' ? 'WhatsApp' : 'Phone'}
                  </span>
                </span>
                <span className="text-xs font-bold text-acc">Add outcome</span>
                <ChevronRight className="h-4 w-4 text-fg-3" aria-hidden="true" />
              </Link>
            </li>
          );
        })}
      </ul>
      {total > calls.length && (
        <Link href="/logs" className="mt-1 block text-xs font-bold text-acc hover:underline">
          {total - calls.length} more in Activity Logs
        </Link>
      )}
    </section>
  );
}
