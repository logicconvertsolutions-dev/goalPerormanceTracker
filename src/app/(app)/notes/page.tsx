import Link from 'next/link';
import { requireVerifiedAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatDisplayDate } from '@/lib/dates';
import { NotesContactPicker } from './notes-contact-picker';

interface TimelineEntry {
  date: string;
  type: 'Call' | 'Appointment' | 'Sale';
  summary: string;
  notes: string | null;
}

export default async function NotesPage({
  searchParams,
}: {
  searchParams: { contact?: string };
}) {
  const session = await requireVerifiedAgent();
  const supabase = await createClient();

  let contact: { id: string; full_name: string } | null = null;
  let entries: TimelineEntry[] = [];

  if (searchParams.contact) {
    const { data } = await supabase
      .from('contacts')
      .select('id, full_name')
      .eq('id', searchParams.contact)
      .eq('agent_id', session.agent!.id)
      .maybeSingle();
    contact = data;
  }

  if (contact) {
    const [{ data: calls }, { data: appointments }, { data: sales }] = await Promise.all([
      supabase
        .from('call_logs')
        .select('call_date, outcome, notes')
        .eq('contact_id', contact.id)
        .order('call_date', { ascending: false }),
      supabase
        .from('appointments')
        .select('appt_date, appt_type, status, notes')
        .eq('contact_id', contact.id)
        .order('appt_date', { ascending: false }),
      supabase
        .from('sales')
        .select('sale_date, product_type, premium_cents, notes')
        .eq('contact_id', contact.id)
        .order('sale_date', { ascending: false }),
    ]);

    entries = [
      ...(calls ?? []).map((c) => ({
        date: c.call_date,
        type: 'Call' as const,
        summary: c.outcome.replace('_', ' '),
        notes: c.notes,
      })),
      ...(appointments ?? []).map((a) => ({
        date: a.appt_date,
        type: 'Appointment' as const,
        summary: `${a.appt_type ?? 'Appointment'} · ${a.status.replace('_', ' ')}`,
        notes: a.notes,
      })),
      ...(sales ?? []).map((s) => ({
        date: s.sale_date,
        type: 'Sale' as const,
        summary: `${s.product_type ?? 'Sale'} · $${(s.premium_cents / 100).toLocaleString('en-CA')}`,
        notes: s.notes,
      })),
    ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-heading-tight text-fg">Meeting Notes</h1>
        {contact && (
          <Link href="/notes" className="text-sm text-acc hover:underline">
            Change contact
          </Link>
        )}
      </div>

      {!contact ? (
        <Card>
          <CardContent className="pt-4 space-y-3">
            <p className="text-sm text-fg-2">
              Pick a contact to see every call, appointment, and sale note for them, in order.
            </p>
            <NotesContactPicker />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{contact.full_name}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {entries.length === 0 ? (
              <p className="text-sm text-fg-3">Nothing logged for {contact.full_name} yet.</p>
            ) : (
              entries.map((e, i) => (
                <div key={i} className="border-b border-line pb-3 last:border-0 last:pb-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="neutral">{e.type}</Badge>
                      <span className="text-sm text-fg font-medium">{formatDisplayDate(e.date)}</span>
                    </div>
                    <span className="text-xs text-fg-3">{e.summary}</span>
                  </div>
                  {e.notes && <p className="text-sm text-fg-2 mt-1">{e.notes}</p>}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
