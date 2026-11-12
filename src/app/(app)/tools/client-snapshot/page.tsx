import { redirect } from 'next/navigation';
import { Monitor } from 'lucide-react';
import { requireVerifiedAgent } from '@/lib/auth/guards';
import { PageHeader } from '@/components/shell/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { ClientSnapshot } from './client-snapshot';

/*
 * Tablet/laptop-only tool (same rules as the other /tools pages): rail-only
 * nav entry, phones get a notice, admins are redirected. Browser-only: the
 * client's details stay in this tab's sessionStorage — never the URL, never
 * the server (lib/snapshot/form.ts).
 */
export default async function ClientSnapshotPage() {
  const session = await requireVerifiedAgent();
  if (session.agent!.role === 'admin') {
    redirect('/admin/orgs');
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Client Snapshot"
        subtitle="Capture income, savings, debts and expenses, then see the monthly balance, net worth and next steps."
      />

      <Card className="md:hidden print:hidden">
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <Monitor className="h-8 w-8 text-fg-3" aria-hidden="true" />
          <p className="font-medium text-fg">Open this on a tablet or laptop</p>
          <p className="max-w-xs text-sm text-fg-3">
            The client snapshot needs a wider screen. Open Kautis on a tablet or computer to use it.
          </p>
        </CardContent>
      </Card>

      <div className="hidden md:block print:block">
        <ClientSnapshot />
      </div>
    </div>
  );
}
