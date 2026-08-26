import { requireVerifiedAgent } from '@/lib/auth/guards';
import { PageHeader } from '@/components/shell/page-header';
import { ImportFlow } from './import-flow';

export default async function ImportPage() {
  await requireVerifiedAgent();

  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader
        title="Import from spreadsheet"
        subtitle="Upload your existing tracker workbook (.xlsx) — Call Log, Appointment Log, Sales Log, and Recruiting Log sheets. Contacts are created automatically from any sheet; a Sales Log row also creates the client record. Matching is by phone first, then name, so re-uploading the same file (or a file with contacts you already have) never creates duplicates."
      />
      <ImportFlow />
    </div>
  );
}
