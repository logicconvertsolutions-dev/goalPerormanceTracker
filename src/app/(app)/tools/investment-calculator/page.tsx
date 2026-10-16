import { redirect } from 'next/navigation';
import { Monitor } from 'lucide-react';
import { requireVerifiedAgent } from '@/lib/auth/guards';
import { PageHeader } from '@/components/shell/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { parseInvestParams } from '@/lib/invest/params';
import { InvestmentCalculator } from './investment-calculator';

/*
 * Tablet/laptop-only tool (same rules as /tools/tax-calculator): rail-only
 * nav entry, phones get a notice. Pure client-side projection — inputs live
 * in this page's query string and the tab's sessionStorage, never the server.
 */
export default async function InvestmentCalculatorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireVerifiedAgent();
  if (session.agent!.role === 'admin') {
    redirect('/admin/orgs');
  }

  const initial = parseInvestParams(await searchParams);

  return (
    <div className="space-y-4 max-w-6xl">
      <PageHeader
        title="Investment Calculator"
        subtitle="See how a lump sum and monthly contributions could grow, compared across growth rates."
      />

      <Card className="md:hidden print:hidden">
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <Monitor className="h-8 w-8 text-fg-3" aria-hidden="true" />
          <p className="font-medium text-fg">Open this on a tablet or laptop</p>
          <p className="max-w-xs text-sm text-fg-3">
            The investment calculator needs a wider screen. Open Kautis on a tablet or computer to use it.
          </p>
        </CardContent>
      </Card>

      <div className="hidden md:block print:block">
        <InvestmentCalculator initial={initial} />
      </div>
    </div>
  );
}
