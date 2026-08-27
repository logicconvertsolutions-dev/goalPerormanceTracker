import Link from 'next/link';
import { requireVerifiedAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/shell/page-header';
import { NotesContactPicker } from './notes-contact-picker';
import { NotesTable, type TimelineEntry } from './notes-table';

export default async function NotesPage({
  searchParams,
}: {
  searchParams: Promise<{ contact?: string }>;
}) {
  const session = await requireVerifiedAgent();
  const supabase = await createClient();
  const { contact: contactId } = await searchParams;

  let contact: { id: string; full_name: string } | null = null;
  let entries: TimelineEntry[] = [];

  if (contactId) {
    const { data } = await supabase
      .from('contacts')
      .select('id, full_name')
      .eq('id', contactId)
      .eq('agent_id', session.agent!.id)
      .maybeSingle();
    contact = data;
  }

  if (contact) {
    const [{ data: calls }, { data: appointments }, { data: sales }] = await Promise.all([
      supabase
        .from('call_logs')
        .select('call_date, outcome, notes, follow_up_on, follow_up_done_at')
        .eq('contact_id', contact.id)
        .order('call_date', { ascending: false }),
      supabase
        .from('appointments')
        .select('appt_date, appt_type, status, notes, follow_up_on, follow_up_done_at')
        .eq('contact_id', contact.id)
        .order('appt_date', { ascending: false }),
      supabase
        .from('sales')
        .select('sale_date, product_type, premium_cents, notes, follow_up_on, follow_up_done_at')
        .eq('contact_id', contact.id)
        .order('sale_date', { ascending: false }),
    ]);

    entries = [
      ...(calls ?? []).map((c) => ({
        date: c.call_date,
        type: 'Call' as const,
        summary: c.outcome.replace('_', ' '),
        notes: c.notes,
        followUpOn: c.follow_up_on,
        followUpDoneAt: c.follow_up_done_at,
      })),
      ...(appointments ?? []).map((a) => ({
        date: a.appt_date,
        type: 'Appointment' as const,
        summary: `${a.appt_type ?? 'Appointment'} · ${a.status.replace('_', ' ')}`,
        notes: a.notes,
        followUpOn: a.follow_up_on,
        followUpDoneAt: a.follow_up_done_at,
      })),
      ...(sales ?? []).map((s) => ({
        date: s.sale_date,
        type: 'Sale' as const,
        summary: `${s.product_type ?? 'Sale'} · $${(s.premium_cents / 100).toLocaleString('en-CA')}`,
        notes: s.notes,
        followUpOn: s.follow_up_on,
        followUpDoneAt: s.follow_up_done_at,
      })),
    ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }

  return (
    <div className={contact ? 'space-y-4 max-w-4xl' : 'space-y-4 max-w-2xl'}>
      <PageHeader
        title="Meeting Notes"
        className="print:hidden"
        action={
          contact && (
            <Link href="/notes" className="text-sm text-acc hover:underline">
              Change contact
            </Link>
          )
        }
      />

      {!contact ? (
        <Card>
          <CardContent className="pt-4 space-y-3">
            <p className="text-sm text-fg-2">
              Pick a contact to see every call, appointment, and sale note for them, in order.
            </p>
            <NotesContactPicker />
          </CardContent>
        </Card>
      ) : entries.length === 0 ? (
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-fg-2">Nothing logged for {contact.full_name} yet.</p>
          </CardContent>
        </Card>
      ) : (
        <NotesTable contactName={contact.full_name} entries={entries} />
      )}
    </div>
  );
}
