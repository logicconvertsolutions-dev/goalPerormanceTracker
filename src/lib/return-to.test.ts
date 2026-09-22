import { describe, expect, it } from 'vitest';
import { APPOINTMENTS_FALLBACK, safeReturnTo, withReturnTo } from './return-to';

describe('safeReturnTo', () => {
  it('keeps an in-app path, query included', () => {
    expect(safeReturnTo('/today')).toBe('/today');
    expect(safeReturnTo('/logs?type=appointment&period=last_cycle')).toBe('/logs?type=appointment&period=last_cycle');
  });

  it('falls back to Activity Logs’ Appointments tab when there is no origin', () => {
    expect(safeReturnTo(undefined)).toBe(APPOINTMENTS_FALLBACK);
    expect(safeReturnTo('')).toBe(APPOINTMENTS_FALLBACK);
  });

  it('never redirects off the app', () => {
    expect(safeReturnTo('https://evil.example')).toBe(APPOINTMENTS_FALLBACK);
    expect(safeReturnTo('//evil.example')).toBe(APPOINTMENTS_FALLBACK);
    expect(safeReturnTo('/\\evil.example')).toBe(APPOINTMENTS_FALLBACK);
    expect(safeReturnTo('javascript:alert(1)')).toBe(APPOINTMENTS_FALLBACK);
  });
});

describe('withReturnTo', () => {
  it('adds the origin as an encoded param', () => {
    expect(withReturnTo('/appointments/abc/edit', '/today')).toBe('/appointments/abc/edit?returnTo=%2Ftoday');
  });

  it('appends to a query the link already has', () => {
    expect(withReturnTo('/appointments/new?contact=c1', '/contacts/c1')).toBe(
      '/appointments/new?contact=c1&returnTo=%2Fcontacts%2Fc1'
    );
  });
});
