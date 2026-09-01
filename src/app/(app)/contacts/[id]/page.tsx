import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireVerifiedAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/shell/page-header';
import { LogActivityButton } from '@/components/shell/log-activity-button';
import { formatDisplayDate } from '@/lib/dates';
import { outcomeBadgeVariant } from '@/lib/call-outcomes';
import { DeleteContactButton } from './delete-contact-button';

export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireVerifiedAgent();
  const supabase = await createClient();

  const { data: contact } = await supabase
    .from('contacts')
    .select('id, full_name, phone, created_at')
    .eq('id', id)
    .eq('agent_id', session.agent!.id)
    .maybeSingle();

  if (!contact) notFound();

  const [{ data: calls }, { data: appointments }, { data: sales }] = await Promise.all([
    supabase
      .from('call_logs')
      .select('id, call_date, source, outcome, notes, follow_up_on, follow_up_done_at')
      .eq('contact_id', contact.id)
      .order('call_date', { ascending: false }),
    supabase
      .from('appointments')
      .select('id, appt_date, status, appt_type')
      .eq('contact_id', contact.id)
      .order('appt_date', { ascending: false }),
    // A contact can have more than one sale — fetch every one, not just the
    // most recent (an earlier .maybeSingle() here would throw on a 2nd sale).
    supabase
      .from('sales')
      .select('id, sale_date, product_type, premium_cents')
      .eq('contact_id', contact.id)
      .order('sale_date', { ascending: false }),
  ]);

  return (
    <div className="space-y-4 max-w-2xl">
      <PageHeader
        title={contact.full_name}
        subtitle={contact.phone ?? undefined}
        action={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="secondary" size="sm">
              <Link href={`/appointments/new?contact=${contact.id}`}>Log appointment</Link>
            </Button>
            <LogActivityButton variant="primary" size="sm" contactId={contact.id} contactName={contact.full_name}>
              Log a call
            </LogActivityButton>
            <DeleteContactButton
              contactId={contact.id}
              fullName={contact.full_name}
              callCount={calls?.length ?? 0}
              appointmentCount={appointments?.length ?? 0}
            />
          </div>
        }
      />

      {Boolean(appointments?.length || sales?.length) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Appointments &amp; sales</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {appointments?.map((a) => (
              <div key={a.id} className="flex items-center justify-between text-sm">
                <span className="text-fg-2">
                  {formatDisplayDate(a.appt_date)} · {a.appt_type ?? 'Appointment'}
                </span>
                <Badge variant="neutral">{a.status.replace('_', ' ')}</Badge>
              </div>
            ))}
            {sales?.map((sale) => (
              <div key={sale.id} className="flex items-center justify-between text-sm">
                <span className="text-fg-2">
                  {formatDisplayDate(sale.sale_date)} · {sale.product_type ?? 'Sale'}
                </span>
                <span className="text-ok font-medium">
                  ${(sale.premium_cents / 100).toLocaleString('en-CA')}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Call history</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {calls && calls.length > 0 ? (
            calls.map((c) => (
              <div key={c.id} className="border-b border-line pb-3 last:border-0 last:pb-0">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-fg font-medium">{formatDisplayDate(c.call_date)}</p>
                  <Badge variant={outcomeBadgeVariant(c.outcome)}>{c.outcome.replace('_', ' ')}</Badge>
                </div>
                {c.notes && <p className="text-sm text-fg-2 mt-1">{c.notes}</p>}
                {c.follow_up_on && (
                  <p className="text-xs text-fg-3 mt-1">
                    Follow-up {formatDisplayDate(c.follow_up_on)}
                    {c.follow_up_done_at ? ' · done' : ''}
                  </p>
                )}
              </div>
            ))
          ) : (
            <p className="text-sm text-fg-3">No calls logged yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
