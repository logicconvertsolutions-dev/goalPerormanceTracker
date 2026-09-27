// P33: a material change to the terms/privacy notice sends everyone who
// accepted an older version back through /terms/accept once -- and
// accepting must always get them out again (staging, 2026-09-27: a version
// dated tomorrow made /terms/accept redirect to itself forever).
import { describe, expect, it } from 'vitest';
import { LEGAL_VERSION_DATE, needsLegalAcceptance } from './legal';

const versionStart = Date.parse(`${LEGAL_VERSION_DATE}T00:00:00Z`);
const HOUR = 60 * 60 * 1000;

describe('needsLegalAcceptance', () => {
  it('asks anyone who never accepted', () => {
    expect(needsLegalAcceptance(null)).toBe(true);
    expect(needsLegalAcceptance(undefined)).toBe(true);
  });

  it('asks again, once the version is in effect, when the acceptance predates it', () => {
    const now = versionStart + 2 * HOUR;
    expect(needsLegalAcceptance('2026-08-01T12:00:00Z', now)).toBe(true);
    expect(needsLegalAcceptance(new Date(versionStart - 60_000).toISOString(), now)).toBe(true);
  });

  it('lets through an acceptance on or after the version day, in Postgres text form too', () => {
    const now = versionStart + 10 * HOUR;
    expect(needsLegalAcceptance(`${LEGAL_VERSION_DATE}T00:00:00Z`, now)).toBe(false);
    expect(needsLegalAcceptance(`${LEGAL_VERSION_DATE} 09:15:00.123+00`, now)).toBe(false);
  });

  it('never asks before a future-dated version takes effect', () => {
    expect(needsLegalAcceptance('2026-08-01T12:00:00Z', versionStart - HOUR)).toBe(false);
  });

  it('accepting right now always satisfies the gate, whatever the date', () => {
    for (const now of [versionStart - 5 * HOUR, versionStart, versionStart + 5 * HOUR]) {
      expect(needsLegalAcceptance(new Date(now).toISOString(), now)).toBe(false);
    }
  });
});
