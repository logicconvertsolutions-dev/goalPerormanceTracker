import { notFound } from 'next/navigation';
import { requireVerifiedAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/shell/page-header';
import { LogForm } from '../../log-form';

export default async function EditCallPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireVerifiedAgent();
  const supabase = await createClient();

  const { data: call } = await supabase
    .from('call_logs')
    .select('id, call_date, source, outcome, notes, follow_up_on')
    .eq('id', id)
    .eq('agent_id', session.agent!.id)
    .maybeSingle();

  if (!call) notFound();

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
        }}
      />
    </div>
  );
}
