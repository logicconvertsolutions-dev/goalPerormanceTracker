import 'server-only';
import * as XLSX from 'xlsx';
import { createHash } from 'node:crypto';

export type CallSource = 'warm_market' | 'referral' | 'cold' | 'social_media' | 'friend' | 'other';
export type CallOutcome = 'connected' | 'voicemail' | 'no_answer' | 'appointment_set' | 'not_interested';
export type ApptStatus = 'scheduled' | 'held' | 'no_show' | 'rescheduled' | 'cancelled';
export type RecruitStatus =
  | 'contacted'
  | 'marketing_presented'
  | 'recruited'
  | 'certified'
  | 'licensed'
  | 'declined';

// Title Case workbook labels -> snake_case DB enum values. Shared source of
// truth for the parser and its tests.
export const SOURCE_LABEL_MAP: Record<string, CallSource> = {
  'Warm Market': 'warm_market',
  Referral: 'referral',
  Cold: 'cold',
  'Social Media': 'social_media',
  Friend: 'friend',
  Other: 'other',
};

export const OUTCOME_LABEL_MAP: Record<string, CallOutcome> = {
  Connected: 'connected',
  Voicemail: 'voicemail',
  'No Answer': 'no_answer',
  'Appointment Set': 'appointment_set',
  'Not Interested': 'not_interested',
};

export const APPT_STATUS_LABEL_MAP: Record<string, ApptStatus> = {
  Scheduled: 'scheduled',
  Held: 'held',
  'No-Show': 'no_show',
  'No Show': 'no_show',
  Rescheduled: 'rescheduled',
  Cancelled: 'cancelled',
};

// Legacy workbook labels ("Interview Scheduled", "Interviewed", "Joined")
// map onto the current pipeline stage names — no exact match for the old
// "Interview Scheduled" wording, so it lands on 'marketing_presented'
// (closest existing value, per product decision).
export const RECRUIT_STATUS_LABEL_MAP: Record<string, RecruitStatus> = {
  Contacted: 'contacted',
  'Interview Scheduled': 'marketing_presented',
  Interviewed: 'marketing_presented',
  'Marketing Presented': 'marketing_presented',
  Joined: 'recruited',
  Recruited: 'recruited',
  Certified: 'certified',
  Licensed: 'licensed',
  Declined: 'declined',
};

export interface CallLogImportData {
  contactName: string;
  company: string | null;
  callDate: string;
  source: CallSource;
  outcome: CallOutcome;
  notes: string | null;
}

export interface AppointmentImportData {
  contactName: string;
  apptDate: string;
  apptType: string | null;
  status: ApptStatus;
  expectedPremiumCents: number;
  referralsGiven: number;
  notes: string | null;
}

export interface SalesImportData {
  clientName: string;
  saleDate: string;
  productType: string | null;
  premiumCents: number;
  notes: string | null;
}

export interface RecruitingImportData {
  prospectName: string;
  logDate: string;
  source: CallSource | null;
  status: RecruitStatus;
  notes: string | null;
}

export type ImportSheetName = 'Call Log' | 'Appointment Log' | 'Sales Log' | 'Recruiting Log';

export interface ParsedRow {
  sheet: ImportSheetName;
  rowNumber: number;
  rowHash: string;
  data: CallLogImportData | AppointmentImportData | SalesImportData | RecruitingImportData | null;
  errors: string[];
}

export interface ParseResult {
  fileHash: string;
  rows: ParsedRow[];
  skippedBlankRows: number;
}

const IMPORTED_SHEETS: ImportSheetName[] = [
  'Call Log',
  'Appointment Log',
  'Sales Log',
  'Recruiting Log',
];

/** Handles both ISO date strings ("2026-07-06") and Excel serial numbers. */
export function parseWorkbookDate(cell: unknown): string | null {
  if (cell === null || cell === undefined || cell === '') return null;

  if (typeof cell === 'number') {
    const parsed = XLSX.SSF.parse_date_code(cell);
    if (!parsed) return null;
    const mm = String(parsed.m).padStart(2, '0');
    const dd = String(parsed.d).padStart(2, '0');
    return `${parsed.y}-${mm}-${dd}`;
  }

  const str = String(cell).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str) && !Number.isNaN(Date.parse(str))) {
    return str;
  }

  return null;
}

/** Title Case -> snake_case DB enum, via an explicit label map. */
export function mapEnumLabel<T extends string>(label: unknown, map: Record<string, T>): T | null {
  if (typeof label !== 'string') return null;
  return map[label.trim()] ?? null;
}

function isBlankRow(row: unknown[]): boolean {
  return row.every((cell) => cell === null || cell === undefined || cell === '');
}

function toMoneyCents(cell: unknown): number {
  const n = typeof cell === 'number' ? cell : Number(cell);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

function toIntOrZero(cell: unknown): number {
  const n = typeof cell === 'number' ? cell : Number(cell);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}

function toTextOrNull(cell: unknown): string | null {
  if (cell === null || cell === undefined) return null;
  const str = String(cell).trim();
  return str === '' ? null : str;
}

function rowHashFor(fileHash: string, sheet: string, rowNumber: number): string {
  return createHash('sha256').update(`${fileHash}|${sheet}|${rowNumber}`).digest('hex');
}

function parseCallLogRow(cells: unknown[]): { data: CallLogImportData | null; errors: string[] } {
  const [dateCell, contactName, company, sourceLabel, outcomeLabel, notes] = cells;
  const errors: string[] = [];

  const callDate = parseWorkbookDate(dateCell);
  if (!callDate) errors.push('Invalid or missing date.');

  const name = toTextOrNull(contactName);
  if (!name) errors.push('Missing contact name.');

  const source = mapEnumLabel(sourceLabel, SOURCE_LABEL_MAP);
  if (!source) errors.push(`Unrecognized source: "${String(sourceLabel)}".`);

  const outcome = mapEnumLabel(outcomeLabel, OUTCOME_LABEL_MAP);
  if (!outcome) errors.push(`Unrecognized outcome: "${String(outcomeLabel)}".`);

  if (errors.length > 0 || !callDate || !name || !source || !outcome) return { data: null, errors };

  return {
    data: { contactName: name, company: toTextOrNull(company), callDate, source, outcome, notes: toTextOrNull(notes) },
    errors: [],
  };
}

function parseAppointmentRow(cells: unknown[]): { data: AppointmentImportData | null; errors: string[] } {
  const [dateCell, contactName, apptType, statusLabel, expectedPremium, referralsGiven, notes] = cells;
  const errors: string[] = [];

  const apptDate = parseWorkbookDate(dateCell);
  if (!apptDate) errors.push('Invalid or missing date.');

  const name = toTextOrNull(contactName);
  if (!name) errors.push('Missing contact name.');

  const status = mapEnumLabel(statusLabel, APPT_STATUS_LABEL_MAP);
  if (!status) errors.push(`Unrecognized status: "${String(statusLabel)}".`);

  if (errors.length > 0 || !apptDate || !name || !status) return { data: null, errors };

  return {
    data: {
      contactName: name,
      apptDate,
      apptType: toTextOrNull(apptType),
      status,
      expectedPremiumCents: toMoneyCents(expectedPremium),
      referralsGiven: toIntOrZero(referralsGiven),
      notes: toTextOrNull(notes),
    },
    errors: [],
  };
}

function parseSalesRow(cells: unknown[]): { data: SalesImportData | null; errors: string[] } {
  const [dateCell, clientName, productType, premium, notes] = cells;
  const errors: string[] = [];

  const saleDate = parseWorkbookDate(dateCell);
  if (!saleDate) errors.push('Invalid or missing date.');

  const name = toTextOrNull(clientName);
  if (!name) errors.push('Missing client name.');

  if (errors.length > 0 || !saleDate || !name) return { data: null, errors };

  return {
    data: {
      clientName: name,
      saleDate,
      productType: toTextOrNull(productType),
      premiumCents: toMoneyCents(premium),
      notes: toTextOrNull(notes),
    },
    errors: [],
  };
}

function parseRecruitingRow(cells: unknown[]): { data: RecruitingImportData | null; errors: string[] } {
  const [dateCell, prospectName, sourceLabel, statusLabel, notes] = cells;
  const errors: string[] = [];

  const logDate = parseWorkbookDate(dateCell);
  if (!logDate) errors.push('Invalid or missing date.');

  const name = toTextOrNull(prospectName);
  if (!name) errors.push('Missing prospect name.');

  const status = mapEnumLabel(statusLabel, RECRUIT_STATUS_LABEL_MAP);
  if (!status) errors.push(`Unrecognized status: "${String(statusLabel)}".`);

  // Source is optional on this sheet (unlike Call Log), so a blank cell is
  // not an error — only an unrecognized non-blank label is.
  const sourceCell = toTextOrNull(sourceLabel);
  const source = sourceCell ? mapEnumLabel(sourceCell, SOURCE_LABEL_MAP) : null;
  if (sourceCell && !source) errors.push(`Unrecognized source: "${sourceCell}".`);

  if (errors.length > 0 || !logDate || !name || !status) return { data: null, errors };

  return {
    data: { prospectName: name, logDate, source, status, notes: toTextOrNull(notes) },
    errors: [],
  };
}

const PARSERS: Record<
  ImportSheetName,
  (cells: unknown[]) => { data: ParsedRow['data']; errors: string[] }
> = {
  'Call Log': parseCallLogRow,
  'Appointment Log': parseAppointmentRow,
  'Sales Log': parseSalesRow,
  'Recruiting Log': parseRecruitingRow,
};

/**
 * Parses the workbook's four activity sheets into importable rows. The
 * "Daily Log" and "Dashboard" sheets are the workbook's own read model /
 * gold-cell targets, never imported as activity rows.
 */
export function parseWorkbook(buffer: Buffer): ParseResult {
  const fileHash = createHash('sha256').update(buffer).digest('hex');
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });

  const rows: ParsedRow[] = [];
  let skippedBlankRows = 0;

  for (const sheetName of IMPORTED_SHEETS) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });
    const dataRows = raw.slice(1); // row 0 is the header

    dataRows.forEach((cells, i) => {
      const rowNumber = i + 2; // 1-based, header is row 1

      if (isBlankRow(cells)) {
        skippedBlankRows += 1;
        return;
      }

      const { data, errors } = PARSERS[sheetName](cells);
      rows.push({
        sheet: sheetName,
        rowNumber,
        rowHash: rowHashFor(fileHash, sheetName, rowNumber),
        data,
        errors,
      });
    });
  }

  return { fileHash, rows, skippedBlankRows };
}
