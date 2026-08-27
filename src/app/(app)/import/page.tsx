import Link from 'next/link';
import { requireVerifiedAgent } from '@/lib/auth/guards';
import { PageHeader } from '@/components/shell/page-header';
import { ImportFlow } from './import-flow';

export default async function ImportPage() {
  await requireVerifiedAgent();

  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader
        title="Import from spreadsheet"
        subtitle="Upload a .xlsx workbook — a plain Contacts sheet (Contact Name, Phone Number), or Call Log, Appointment Log, Sales Log, and Recruiting Log sheets. Contacts are created automatically from any sheet; a Sales Log row also creates the client record. Matching is by phone first, then name, so re-uploading the same file (or a file with contacts you already have) never creates duplicates."
      />
      <p className="text-sm text-fg-3">
        Not sure of the format?{' '}
        <Link href="/import/template?type=contacts" className="text-acc hover:underline">
          Download the contacts template
        </Link>{' '}
        or{' '}
        <Link href="/import/template?type=clients" className="text-acc hover:underline">
          the clients template
        </Link>
        .
      </p>
      <ImportFlow />
    </div>
  );
}
