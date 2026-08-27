import { notFound } from 'next/navigation';
import { requireVerifiedAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/shell/page-header';
import { SaleForm } from '../../sale-form';

export default async function EditSalePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireVerifiedAgent();
  const supabase = await createClient();

  const { data: sale } = await supabase
    .from('sales')
    .select('id, sale_date, product_type, premium_cents, notes, follow_up_on')
    .eq('id', id)
    .eq('agent_id', session.agent!.id)
    .maybeSingle();

  if (!sale) notFound();

  return (
    <div className="max-w-md space-y-4">
      <PageHeader title="Edit sale" />
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
