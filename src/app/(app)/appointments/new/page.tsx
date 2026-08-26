import { requireVerifiedAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/shell/page-header';
import { AppointmentForm } from '../appointment-form';

export default async function NewAppointmentPage({
  searchParams,
}: {
  searchParams: { contact?: string };
}) {
  const session = await requireVerifiedAgent();

  let prefill: { id: string; full_name: string } | null = null;
  if (searchParams.contact) {
    const supabase = await createClient();
    const { data: contact } = await supabase
      .from('contacts')
      .select('id, full_name')
      .eq('id', searchParams.contact)
      .eq('agent_id', session.agent!.id)
      .maybeSingle();
    prefill = contact;
  }

  return (
    <div className="max-w-md space-y-4">
      <PageHeader title="Log appointment" />
      <AppointmentForm
        mode="create"
        prefillContactName={prefill?.full_name}
        prefillContactId={prefill?.id}
      />
    </div>
  );
}
