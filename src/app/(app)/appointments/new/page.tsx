import { requireAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { AppointmentForm } from '../appointment-form';

export default async function NewAppointmentPage({
  searchParams,
}: {
  searchParams: { contact?: string };
}) {
  const session = await requireAgent();

  let prefill: { full_name: string; company: string | null } | null = null;
  if (searchParams.contact) {
    const supabase = await createClient();
    const { data: contact } = await supabase
      .from('contacts')
      .select('full_name, company')
      .eq('id', searchParams.contact)
      .eq('agent_id', session.agent!.id)
      .maybeSingle();
    prefill = contact;
  }

  return (
    <div className="max-w-md space-y-4">
      <h1 className="text-xl font-semibold tracking-heading-tight text-fg">Log appointment</h1>
      <AppointmentForm
        mode="create"
        prefillContactName={prefill?.full_name}
        prefillCompany={prefill?.company ?? undefined}
      />
    </div>
  );
}
