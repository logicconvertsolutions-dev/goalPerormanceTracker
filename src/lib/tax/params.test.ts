import { describe, expect, it } from 'vitest';
import { parseTaxParams, serializeTaxParams } from './params';

describe('tax calculator URL params', () => {
  it('defaults an empty query to Ontario, annual, 40 hours, all zero', () => {
    const p = parseTaxParams({});
    expect(p.province).toBe('ON');
    expect(p.payPeriod).toBe('annual');
    expect(p.hoursPerWeek).toBe(40);
    expect(p.employmentIncome).toBe(0);
  });

  it('falls back to defaults for hand-edited garbage instead of throwing', () => {
    const p = parseTaxParams({ prov: 'ZZ', per: 'fortnightly', hrs: '-3', emp: 'lots', se: '-500' });
    expect(p.province).toBe('ON');
    expect(p.payPeriod).toBe('annual');
    expect(p.hoursPerWeek).toBe(40);
    expect(p.employmentIncome).toBe(0);
    expect(p.selfEmploymentIncome).toBe(0);
  });

  it('round-trips a scenario and omits defaults', () => {
    const p = parseTaxParams({ prov: 'QC', per: 'hourly', hrs: '37.5', emp: '28', rrsp: '2000' });
    const qs = serializeTaxParams(p);
    expect(qs.toString()).toBe('prov=QC&per=hourly&hrs=37.5&emp=28&rrsp=2000');
    expect(parseTaxParams(Object.fromEntries(qs))).toEqual(p);
  });

  it('takes the first value of a repeated param', () => {
    expect(parseTaxParams({ emp: ['100', '200'] }).employmentIncome).toBe(100);
  });
});
