import { requireVerifiedAgent } from '@/lib/auth/guards';
import { SaleForm } from '../sale-form';

export default async function NewSalePage() {
  await requireVerifiedAgent();

  return (
    <div className="max-w-md space-y-4">
      <h1 className="text-xl font-semibold tracking-heading-tight text-fg">Log sale</h1>
      <SaleForm mode="create" />
    </div>
  );
}
