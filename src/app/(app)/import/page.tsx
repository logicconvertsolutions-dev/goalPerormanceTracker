import { requireVerifiedAgent } from '@/lib/auth/guards';
import { ImportFlow } from './import-flow';

export default async function ImportPage() {
  await requireVerifiedAgent();

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold tracking-heading-tight text-fg">Import from spreadsheet</h1>
      <p className="text-sm text-fg-2">
        Upload your existing tracker workbook (.xlsx). We&apos;ll show you what would be
        imported before anything is saved — re-uploading the same file is always safe.
      </p>
      <ImportFlow />
    </div>
  );
}
