import { notFound } from 'next/navigation';
import { requireVerifiedAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { AppointmentForm } from '../../appointment-form';

export default async function EditAppointmentPage({ params }: { params: { id: string } }) {
  const session = await requireVerifiedAgent();
  const supabase = await createClient();

  const { data: appointment } = await supabase
    .from('appointments')
    .select(
      'id, appt_date, appt_type, status, expected_premium_cents, referrals_given, notes, follow_up_on'
    )
    .eq('id', params.id)
    .eq('agent_id', session.agent!.id)
    .maybeSingle();

  if (!appointment) notFound();

  return (
    <div className="max-w-md space-y-4">
      <h1 className="text-xl font-semibold tracking-heading-tight text-fg">Edit appointment</h1>
      <AppointmentForm
        mode="edit"
        defaultValues={{
          id: appointment.id,
          apptDate: appointment.appt_date,
          apptType: appointment.appt_type,
          status: appointment.status,
          expectedPremiumCents: appointment.expected_premium_cents,
          referralsGiven: appointment.referrals_given,
          notes: appointment.notes,
          followUpOn: appointment.follow_up_on,
        }}
      />
    </div>
  );
}
