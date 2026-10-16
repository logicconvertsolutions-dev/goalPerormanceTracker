import { redirect } from 'next/navigation';
import { Monitor } from 'lucide-react';
import { requireVerifiedAgent } from '@/lib/auth/guards';
import { PageHeader } from '@/components/shell/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { parseTaxParams } from '@/lib/tax/params';
import { TAX_YEAR } from '@/lib/tax/rates-2026';
import { TaxCalculator } from './tax-calculator';

/*
 * Tablet/laptop-only tool: the nav entry lives in the rail (md+ only), and a
 * phone that reaches this URL directly gets a notice instead of the form.
 * Pure client-side estimate — no data leaves the browser except the inputs
 * in this page's own query string.
 */
export default async function TaxCalculatorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireVerifiedAgent();
  if (session.agent!.role === 'admin') {
    redirect('/admin/orgs');
  }

  const initial = parseTaxParams(await searchParams);

  return (
    <div className="space-y-4 max-w-6xl">
      <PageHeader
        title="Tax Calculator"
        subtitle={`Estimate ${TAX_YEAR} income tax, CPP/QPP and EI, after-tax income and your refund or balance owing.`}
      />

      <Card className="md:hidden">
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <Monitor className="h-8 w-8 text-fg-3" aria-hidden="true" />
          <p className="font-medium text-fg">Open this on a tablet or laptop</p>
          <p className="max-w-xs text-sm text-fg-3">
            The tax calculator needs a wider screen. Open Kautis on a tablet or computer to use it.
          </p>
        </CardContent>
      </Card>

      <div className="hidden md:block">
        <TaxCalculator initial={initial} />
      </div>
    </div>
  );
}
