import { NextRequest } from 'next/server';
import * as XLSX from 'xlsx';
import { requireAgent } from '@/lib/auth/guards';

// Sample workbooks for the two "just my list" import paths — a plain
// Contacts sheet, and a Sales Log sheet (which doubles as the Clients
// import: any Sales Log row creates the contact and the sale that makes
// them show up on /clients). One example row shows the expected format;
// its text makes clear it's a placeholder to replace, not data to keep.
const TEMPLATES = {
  contacts: {
    filename: 'contacts-import-template.xlsx',
    sheetName: 'Contacts',
    rows: [
      ['Contact Name'],
      ['Jane Doe (delete this example row)'],
    ],
  },
  clients: {
    filename: 'clients-import-template.xlsx',
    sheetName: 'Sales Log',
    rows: [
      ['Date', 'Client Name', 'Product Type', 'Premium Amount', 'Notes'],
      ['2026-01-15', 'Jane Doe (delete this example row)', 'Universal Life', 1500, 'Referred by John'],
    ],
  },
} as const;

type TemplateType = keyof typeof TEMPLATES;

function isTemplateType(v: string | null): v is TemplateType {
  return !!v && v in TEMPLATES;
}

export async function GET(request: NextRequest) {
  await requireAgent();

  const type = new URL(request.url).searchParams.get('type');
  if (!isTemplateType(type)) {
    return new Response('Unknown template type — expected ?type=contacts or ?type=clients.', { status: 400 });
  }

  const template = TEMPLATES[type];
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(template.rows.map((row) => [...row]));
  XLSX.utils.book_append_sheet(workbook, sheet, template.sheetName);
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${template.filename}"`,
    },
  });
}
