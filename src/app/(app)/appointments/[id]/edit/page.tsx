import { notFound } from 'next/navigation';
import { requireVerifiedAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/shell/page-header';
import { AppointmentForm } from '../../appointment-form';
import { safeReturnTo } from '@/lib/return-to';

export default async function EditAppointmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const { id } = await params;
  const { returnTo } = await searchParams;
  const session = await requireVerifiedAgent();
  const supabase = await createClient();

  const { data: appointment } = await supabase
    .from('appointments')
    .select(
      'id, contact_id, appt_date, appointment_at, scheduled_for, appt_type, status, expected_premium_cents, referrals_given, notes, follow_up_on, rescheduled_to_id, contacts(full_name)'
    )
    .eq('id', id)
    .eq('agent_id', session.agent!.id)
    .maybeSingle();

  if (!appointment) notFound();

  // A sale/recruiting log this appointment already spawned via the form's
  // "Log as a Sale" / "Recruited?" toggles (sales/recruiting_logs.
  // appointment_id) -- letting the form find these means re-saving an
  // edited appointment updates the linked record instead of creating a
  // second one.
  const [{ data: linkedSale }, { data: linkedRecruitingLog }] = await Promise.all([
    supabase
      .from('sales')
      .select('id, product_type')
      .eq('appointment_id', id)
      .eq('agent_id', session.agent!.id)
      .maybeSingle(),
    supabase
      .from('recruiting_logs')
      .select('id')
      .eq('appointment_id', id)
      .eq('agent_id', session.agent!.id)
      .maybeSingle(),
  ]);

  return (
    <div className="max-w-md space-y-4">
      <PageHeader title="Edit appointment" />
      <AppointmentForm
        mode="edit"
        returnTo={safeReturnTo(returnTo)}
        defaultValues={{
          id: appointment.id,
          contactId: appointment.contact_id ?? undefined,
          contactName: (appointment.contacts as { full_name: string } | null)?.full_name,
          apptDate: appointment.appt_date,
          appointmentAt: appointment.appointment_at,
          // P25 C2 (F6): scheduled_for is the slot that survives
          // resolution (Phase B), so the form shows the appointment's real
          // date instead of falling back to today.
          scheduledFor: appointment.scheduled_for,
          apptType: appointment.appt_type,
          status: appointment.status,
          expectedPremiumCents: appointment.expected_premium_cents,
          referralsGiven: appointment.referrals_given,
          notes: appointment.notes,
          followUpOn: appointment.follow_up_on,
          linkedSaleId: linkedSale?.id,
          linkedSaleProductType: linkedSale?.product_type,
          linkedRecruitingLogId: linkedRecruitingLog?.id,
          rescheduledToId: appointment.rescheduled_to_id,
        }}
      />
    </div>
  );
}
