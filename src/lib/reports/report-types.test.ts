import { describe, it, expect } from 'vitest';
import { isReportTypeId, resolveColumns, formatCell, REPORT_TYPES } from './report-types';

describe('isReportTypeId', () => {
  it('accepts every known report type id', () => {
    for (const id of Object.keys(REPORT_TYPES)) {
      expect(isReportTypeId(id)).toBe(true);
    }
  });

  it('rejects unknown or empty values', () => {
    expect(isReportTypeId('not_a_type')).toBe(false);
    expect(isReportTypeId(null)).toBe(false);
    expect(isReportTypeId(undefined)).toBe(false);
  });
});

describe('resolveColumns', () => {
  it('falls back to the default columns when none are requested', () => {
    const columns = resolveColumns('agent_roster', null);
    expect(columns.map((c) => c.key)).toEqual(REPORT_TYPES.agent_roster.defaultColumns);
  });

  it('preserves the requested order and drops unknown keys', () => {
    const columns = resolveColumns('activity_summary', ['premium_cents', 'not_a_column', 'full_name']);
    expect(columns.map((c) => c.key)).toEqual(['premium_cents', 'full_name']);
  });
});

describe('formatCell', () => {
  it('formats money as dollars with two decimal places', () => {
    expect(formatCell(188_00, 'money')).toBe('$188.00');
  });

  it('formats percent by appending a % sign', () => {
    expect(formatCell(87.5, 'percent')).toBe('87.5%');
  });

  it('formats booleans as Yes/No', () => {
    expect(formatCell(true, 'boolean')).toBe('Yes');
    expect(formatCell(false, 'boolean')).toBe('No');
  });

  it('renders null/undefined as an em dash', () => {
    expect(formatCell(null)).toBe('—');
    expect(formatCell(undefined)).toBe('—');
  });

  it('stringifies unformatted values as-is', () => {
    expect(formatCell('Active')).toBe('Active');
    expect(formatCell(42)).toBe('42');
  });
});
