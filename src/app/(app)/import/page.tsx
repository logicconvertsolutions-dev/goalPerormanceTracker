import { requireVerifiedAgent } from '@/lib/auth/guards';
import { PageHeader } from '@/components/shell/page-header';
import { ImportFlow } from './import-flow';

export default async function ImportPage() {
  await requireVerifiedAgent();

  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader
        title="Import from spreadsheet"
        subtitle="Upload your existing tracker workbook (.xlsx). We'll show you what would be imported before anything is saved — re-uploading the same file is always safe."
      />
      <ImportFlow />
    </div>
  );
}
