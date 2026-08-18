import { requireAgent } from '@/lib/auth/guards';
import { RecruitingForm } from '../recruiting-form';

export default async function NewRecruitingLogPage() {
  await requireAgent();

  return (
    <div className="max-w-md space-y-4">
      <h1 className="text-xl font-semibold tracking-heading-tight text-fg">Log conversation</h1>
      <RecruitingForm mode="create" />
    </div>
  );
}
