import { notFound } from 'next/navigation';
import { requireAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { RecruitingForm } from '../../recruiting-form';

export default async function EditRecruitingLogPage({ params }: { params: { id: string } }) {
  const session = await requireAgent();
  const supabase = await createClient();

  const { data: log } = await supabase
    .from('recruiting_logs')
    .select('id, log_date, source, status, notes')
    .eq('id', params.id)
    .eq('agent_id', session.agent!.id)
    .maybeSingle();

  if (!log) notFound();

  return (
    <div className="max-w-md space-y-4">
      <h1 className="text-xl font-semibold tracking-heading-tight text-fg">Edit recruiting log</h1>
      <RecruitingForm
        mode="edit"
        defaultValues={{
          id: log.id,
          logDate: log.log_date,
          source: log.source,
          status: log.status,
          notes: log.notes,
        }}
      />
    </div>
  );
}
