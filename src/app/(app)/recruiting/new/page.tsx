import { requireVerifiedAgent } from '@/lib/auth/guards';
import { PageHeader } from '@/components/shell/page-header';
import { RecruitingForm } from '../recruiting-form';

export default async function NewRecruitingLogPage() {
  await requireVerifiedAgent();

  return (
    <div className="max-w-md space-y-4">
      <PageHeader title="Log conversation" />
      <RecruitingForm mode="create" />
    </div>
  );
}
