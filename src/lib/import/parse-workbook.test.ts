// @vitest-environment node
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { mapEnumLabel, parseWorkbook, parseWorkbookDate, SOURCE_LABEL_MAP } from './parse-workbook';

function buildWorkbook(sheets: Record<string, unknown[][]>): Buffer {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

const CONTACTS_HEADER = ['Contact Name', 'Phone Number'];
const CALL_LOG_HEADER = ['Date', 'Contact Name', 'Company', 'Source', 'Outcome', 'Notes'];
const APPT_HEADER = ['Date', 'Contact Name', 'Type', 'Status', 'Expected Premium ($)', 'Referrals Given', 'Notes'];
const SALES_HEADER = ['Date', 'Client Name', 'Product Type', 'Premium Amount', 'Notes'];
const RECRUITING_HEADER = ['Date', 'Prospect Name', 'Source', 'Status', 'Notes'];

describe('parseWorkbookDate', () => {
  it('parses ISO date strings', () => {
    expect(parseWorkbookDate('2026-07-06')).toBe('2026-07-06');
  });
  it('parses Excel serial numbers', () => {
    expect(parseWorkbookDate(46215)).toBe('2026-07-12');
  });
  it('returns null for garbage input', () => {
    expect(parseWorkbookDate('not a date')).toBeNull();
    expect(parseWorkbookDate(null)).toBeNull();
    expect(parseWorkbookDate(undefined)).toBeNull();
  });
});

describe('mapEnumLabel', () => {
  it('maps a known Title Case label to its enum value', () => {
    expect(mapEnumLabel('Warm Market', SOURCE_LABEL_MAP)).toBe('warm_market');
  });
  it('returns null for an unrecognized label', () => {
    expect(mapEnumLabel('Not A Source', SOURCE_LABEL_MAP)).toBeNull();
  });
  it('returns null for non-string input', () => {
    expect(mapEnumLabel(null, SOURCE_LABEL_MAP)).toBeNull();
  });
});

describe('parseWorkbook', () => {
  it('maps headers correctly for each sheet', () => {
    const buf = buildWorkbook({
      'Call Log': [
        CALL_LOG_HEADER,
        ['2026-07-06', 'Jane Doe', 'Acme Inc.', 'Warm Market', 'Appointment Set', 'Interested'],
      ],
      'Appointment Log': [APPT_HEADER, ['2026-07-08', 'Jane Doe', 'Initial Meeting', 'Held', 85, 1, 'note']],
      'Sales Log': [SALES_HEADER, ['2026-07-09', 'Jane Doe', 'Universal Life', 85, 'note']],
      'Recruiting Log': [RECRUITING_HEADER, ['2026-07-07', 'Alex Kumar', 'Referral', 'Interview Scheduled', 'note']],
    });

    const result = parseWorkbook(buf);
    expect(result.rows).toHaveLength(4);

    const call = result.rows.find((r) => r.sheet === 'Call Log')!;
    expect(call.errors).toEqual([]);
    expect(call.data).toMatchObject({
      contactName: 'Jane Doe',
      callDate: '2026-07-06',
      source: 'warm_market',
      outcome: 'appointment_set',
    });

    const appt = result.rows.find((r) => r.sheet === 'Appointment Log')!;
    expect(appt.errors).toEqual([]);
    expect(appt.data).toMatchObject({
      contactName: 'Jane Doe',
      apptDate: '2026-07-08',
      apptType: 'Initial Meeting',
      status: 'held',
      expectedPremiumCents: 8500,
      referralsGiven: 1,
    });

    const sale = result.rows.find((r) => r.sheet === 'Sales Log')!;
    expect(sale.errors).toEqual([]);
    expect(sale.data).toMatchObject({
      clientName: 'Jane Doe',
      saleDate: '2026-07-09',
      productType: 'Universal Life',
      premiumCents: 8500,
    });

    const recruiting = result.rows.find((r) => r.sheet === 'Recruiting Log')!;
    expect(recruiting.errors).toEqual([]);
    // "Interview Scheduled" maps to 'marketing_presented' — no exact enum match exists.
    expect(recruiting.data).toMatchObject({
      prospectName: 'Alex Kumar',
      logDate: '2026-07-07',
      source: 'referral',
      status: 'marketing_presented',
    });
  });

  it('parses the simple Contacts sheet (name + optional phone)', () => {
    const buf = buildWorkbook({
      Contacts: [CONTACTS_HEADER, ['Jane Doe', '555-123-4567']],
    });

    const result = parseWorkbook(buf);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].errors).toEqual([]);
    expect(result.rows[0].data).toEqual({ fullName: 'Jane Doe', phone: '555-123-4567' });
  });

  it('does not require a phone number on the Contacts sheet', () => {
    const buf = buildWorkbook({
      Contacts: [CONTACTS_HEADER, ['Jane Doe', null]],
    });

    const result = parseWorkbook(buf);
    expect(result.rows[0].errors).toEqual([]);
    expect(result.rows[0].data).toEqual({ fullName: 'Jane Doe', phone: null });
  });

  it('parses an optional trailing Phone column without disturbing existing columns', () => {
    const buf = buildWorkbook({
      'Call Log': [
        [...CALL_LOG_HEADER, 'Phone'],
        ['2026-07-06', 'Jane Doe', 'Acme Inc.', 'Warm Market', 'Connected', 'note', '555-123-4567'],
      ],
    });

    const result = parseWorkbook(buf);
    expect(result.rows[0].errors).toEqual([]);
    expect(result.rows[0].data).toMatchObject({ contactName: 'Jane Doe', contactPhone: '555-123-4567' });
  });

  it('leaves contactPhone null when the workbook has no Phone column at all', () => {
    const buf = buildWorkbook({
      'Call Log': [CALL_LOG_HEADER, ['2026-07-06', 'Jane Doe', null, 'Warm Market', 'Connected', null]],
    });

    const result = parseWorkbook(buf);
    expect(result.rows[0].data).toMatchObject({ contactPhone: null });
  });

  it('skips fully-blank rows without emitting them', () => {
    const buf = buildWorkbook({
      'Call Log': [
        CALL_LOG_HEADER,
        ['2026-07-06', 'Jane Doe', null, 'Warm Market', 'Connected', null],
        [null, null, null, null, null, null],
        [null, null, null, null, null, null],
      ],
    });

    const result = parseWorkbook(buf);
    expect(result.rows).toHaveLength(1);
    expect(result.skippedBlankRows).toBe(2);
  });

  it('collects a row error for a malformed date instead of throwing', () => {
    const buf = buildWorkbook({
      'Call Log': [CALL_LOG_HEADER, ['not-a-date', 'Jane Doe', null, 'Warm Market', 'Connected', null]],
    });

    const result = parseWorkbook(buf);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].data).toBeNull();
    expect(result.rows[0].errors).toContain('Invalid or missing date.');
  });

  it('collects a row error for an unrecognized enum label', () => {
    const buf = buildWorkbook({
      'Call Log': [CALL_LOG_HEADER, ['2026-07-06', 'Jane Doe', null, 'Not A Source', 'Connected', null]],
    });

    const result = parseWorkbook(buf);
    expect(result.rows[0].errors.some((e) => e.includes('Unrecognized source'))).toBe(true);
  });

  it('does not fail-fast: a bad row does not stop later rows from parsing', () => {
    const buf = buildWorkbook({
      'Call Log': [
        CALL_LOG_HEADER,
        ['not-a-date', 'Bad Row', null, 'Warm Market', 'Connected', null],
        ['2026-07-06', 'Good Row', null, 'Warm Market', 'Connected', null],
      ],
    });

    const result = parseWorkbook(buf);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].errors.length).toBeGreaterThan(0);
    expect(result.rows[1].errors).toEqual([]);
  });

  it('never imports the Daily Log or Dashboard sheets', () => {
    const buf = buildWorkbook({
      'Call Log': [CALL_LOG_HEADER],
      'Daily Log': [['Date', 'Calls Made'], ['2026-07-06', 5]],
      Dashboard: [['WFG Weekly Report']],
    });

    const result = parseWorkbook(buf);
    expect(result.rows.every((r) => r.sheet !== ('Daily Log' as never) && r.sheet !== ('Dashboard' as never))).toBe(
      true
    );
  });

  it('produces a stable rowHash for the same file re-parsed (idempotency basis)', () => {
    const buf = buildWorkbook({
      'Call Log': [CALL_LOG_HEADER, ['2026-07-06', 'Jane Doe', null, 'Warm Market', 'Connected', null]],
    });

    const first = parseWorkbook(buf);
    const second = parseWorkbook(buf);
    expect(first.rows[0].rowHash).toBe(second.rows[0].rowHash);
  });

  it('gives two identical rows at different positions different hashes (both must import)', () => {
    const buf = buildWorkbook({
      'Call Log': [
        CALL_LOG_HEADER,
        ['2026-07-06', 'Jane Doe', null, 'Warm Market', 'Connected', 'Same day, same outcome'],
        ['2026-07-06', 'Jane Doe', null, 'Warm Market', 'Connected', 'Same day, same outcome'],
      ],
    });

    const result = parseWorkbook(buf);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].rowHash).not.toBe(result.rows[1].rowHash);
  });

  it('a row referencing no agent_id column at all is fine — the parser never reads agent identity from the file', () => {
    // The workbook has no agent_id column by design; this test documents that
    // invariant rather than exercising a code path, since agent identity is
    // always supplied by the authenticated session at commit time, never the file.
    const buf = buildWorkbook({
      'Call Log': [CALL_LOG_HEADER, ['2026-07-06', 'Jane Doe', null, 'Warm Market', 'Connected', null]],
    });
    const result = parseWorkbook(buf);
    expect(result.rows[0].data).not.toHaveProperty('agentId');
  });
});
