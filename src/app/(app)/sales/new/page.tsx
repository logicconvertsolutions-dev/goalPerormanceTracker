import { requireVerifiedAgent } from '@/lib/auth/guards';
import { PageHeader } from '@/components/shell/page-header';
import { SaleForm } from '../sale-form';

export default async function NewSalePage() {
  await requireVerifiedAgent();

  return (
    <div className="max-w-md space-y-4">
      <PageHeader title="Log sale" />
      <SaleForm mode="create" />
    </div>
  );
}
