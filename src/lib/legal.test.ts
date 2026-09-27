// P33: a material change to the terms/privacy notice sends everyone who
// accepted an older version back through /terms/accept once.
import { describe, expect, it } from 'vitest';
import { LEGAL_VERSION_DATE, needsLegalAcceptance } from './legal';

describe('needsLegalAcceptance', () => {
  it('asks anyone who never accepted', () => {
    expect(needsLegalAcceptance(null)).toBe(true);
    expect(needsLegalAcceptance(undefined)).toBe(true);
  });

  it('asks again when the acceptance predates the current version', () => {
    expect(needsLegalAcceptance('2026-08-01T12:00:00Z')).toBe(true);
    // Postgres's own timestamptz text, one minute before the version day.
    expect(needsLegalAcceptance(`2026-09-27 23:59:00+00`)).toBe(true);
  });

  it('lets through an acceptance on or after the version day', () => {
    expect(needsLegalAcceptance(`${LEGAL_VERSION_DATE}T00:00:00Z`)).toBe(false);
    expect(needsLegalAcceptance(`${LEGAL_VERSION_DATE} 09:15:00.123+00`)).toBe(false);
    expect(needsLegalAcceptance('2027-01-01T00:00:00Z')).toBe(false);
  });
});
