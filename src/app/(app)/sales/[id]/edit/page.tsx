import { notFound } from 'next/navigation';
import { requireVerifiedAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { SaleForm } from '../../sale-form';

export default async function EditSalePage({ params }: { params: { id: string } }) {
  const session = await requireVerifiedAgent();
  const supabase = await createClient();

  const { data: sale } = await supabase
    .from('sales')
    .select('id, sale_date, product_type, premium_cents, notes, follow_up_on')
    .eq('id', params.id)
    .eq('agent_id', session.agent!.id)
    .maybeSingle();

  if (!sale) notFound();

  return (
    <div className="max-w-md space-y-4">
      <h1 className="text-xl font-semibold tracking-heading-tight text-fg">Edit sale</h1>
      <SaleForm
        mode="edit"
        defaultValues={{
          id: sale.id,
          saleDate: sale.sale_date,
          productType: sale.product_type,
          premiumCents: sale.premium_cents,
          notes: sale.notes,
          followUpOn: sale.follow_up_on,
        }}
      />
    </div>
  );
}
