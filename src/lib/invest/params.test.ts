import { describe, expect, it } from 'vitest';
import { parseInvestParams, serializeInvestParams } from './params';

describe('investment calculator URL params', () => {
  it('defaults: 4/6/8/10% all on, 25 years, month-end, 2% inflation', () => {
    const p = parseInvestParams({});
    expect(p.rates).toEqual([
      { rate: 0.04, on: true },
      { rate: 0.06, on: true },
      { rate: 0.08, on: true },
      { rate: 0.1, on: true },
    ]);
    expect(p.years).toBe(25);
    expect(p.timing).toBe('end');
    expect(p.inflation).toBe(0.02);
    expect(p.showReal).toBe(false);
    expect(serializeInvestParams(p).toString()).toBe('');
  });

  it('falls back to defaults for garbage', () => {
    const p = parseInvestParams({ yrs: '99', r1: '-3', r2: '500', on: '12x1', tim: 'later', ls: 'lots' });
    expect(p.years).toBe(25);
    expect(p.rates[0].rate).toBe(0.04);
    expect(p.rates[1].rate).toBe(0.06);
    expect(p.rates.every((r) => r.on)).toBe(true);
    expect(p.timing).toBe('end');
    expect(p.lumpSum).toBe(0);
  });

  it('round-trips a scenario without float noise', () => {
    const p = parseInvestParams({
      ls: '25000', mo: '500', yrs: '30', r3: '7.5', on: '1010', inc: '3', tim: 'start', real: '1', goal: '1000000',
    });
    expect(p.rates[2].rate).toBe(0.075);
    const qs = serializeInvestParams(p).toString();
    expect(qs).toBe('ls=25000&mo=500&yrs=30&r3=7.5&on=1010&inc=3&tim=start&real=1&goal=1000000');
    expect(parseInvestParams(Object.fromEntries(new URLSearchParams(qs)))).toEqual(p);
  });
});
