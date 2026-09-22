import { notFound } from 'next/navigation';
import { requireVerifiedAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/shell/page-header';
import { LogForm } from '../../log-form';
import { callFormAppointmentAt } from './linked-appointment';

export default async function EditCallPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireVerifiedAgent();
  const supabase = await createClient();

  const { data: call } = await supabase
    .from('call_logs')
    .select('id, call_date, source, outcome, notes, follow_up_on, appointment_at, appointments(appt_type, scheduled_for)')
    .eq('id', id)
    .eq('agent_id', session.agent!.id)
    .maybeSingle();

  if (!call) notFound();

  // P25 C1: the appointment this call created is the record now, so the
  // form's Type select must show that row's type rather than silently
  // re-defaulting to Follow Up and writing it back on save. The embed is on
  // appointments.source_call_log_id, so it is at most one row.
  const linked = call.appointments?.[0];
  const linkedApptType = linked?.appt_type ?? null;

  return (
    <div className="max-w-md space-y-4">
      <PageHeader title="Edit call" />
      <LogForm
        mode="edit"
        defaultValues={{
          id: call.id,
          callDate: call.call_date,
          source: call.source,
          outcome: call.outcome,
          notes: call.notes,
          followUpOn: call.follow_up_on,
          appointmentAt: callFormAppointmentAt(call.appointment_at, linked),
          apptType: linkedApptType,
        }}
      />
    </div>
  );
}
