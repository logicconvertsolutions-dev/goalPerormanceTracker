import { notFound } from 'next/navigation';
import { requireVerifiedAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/shell/page-header';
import { RecruitingForm } from '../../recruiting-form';

export default async function EditRecruitingLogPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireVerifiedAgent();
  const supabase = await createClient();

  const { data: log } = await supabase
    .from('recruiting_logs')
    .select('id, log_date, source, status, notes')
    .eq('id', id)
    .eq('agent_id', session.agent!.id)
    .maybeSingle();

  if (!log) notFound();

  return (
    <div className="max-w-md space-y-4">
      <PageHeader title="Edit recruiting log" />
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
