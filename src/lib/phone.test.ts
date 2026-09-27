// P33: phone numbers are stored in E.164 only, so WhatsApp's wa.me handoff
// always has a country code and the database's check never has to reject
// something the form let through.
import { describe, expect, it } from 'vitest';
import {
  E164,
  formatPhone,
  optionalPhoneSchema,
  parsePhone,
  phoneError,
  phoneFromDevice,
  telHref,
  whatsAppHref,
} from './phone';

describe('parsePhone', () => {
  it('accepts international numbers and strips formatting', () => {
    expect(parsePhone('+1 (416) 555-0123')).toEqual({ ok: true, e164: '+14165550123' });
    expect(parsePhone('+44 7911 123456')).toEqual({ ok: true, e164: '+447911123456' });
    expect(parsePhone('0091 98765 43210')).toEqual({ ok: true, e164: '+919876543210' });
    expect(parsePhone('+1.416.555.0123')).toEqual({ ok: true, e164: '+14165550123' });
  });

  it('asks for the country code, suggesting +1 for North American numbers', () => {
    expect(parsePhone('416-555-0123')).toEqual({
      ok: false,
      reason: 'missing_country_code',
      suggestion: '+14165550123',
    });
    expect(parsePhone('1 416 555 0123')).toEqual({
      ok: false,
      reason: 'missing_country_code',
      suggestion: '+14165550123',
    });
    expect(parsePhone('07911 123456')).toEqual({ ok: false, reason: 'missing_country_code', suggestion: null });
  });

  it('refuses what is not a phone number', () => {
    expect(parsePhone('+1416555abcd')).toEqual({ ok: false, reason: 'invalid' });
    expect(parsePhone('+0165550123')).toEqual({ ok: false, reason: 'invalid' });
    expect(parsePhone('+1234567')).toEqual({ ok: false, reason: 'invalid' });
    expect(parsePhone('call me')).toEqual({ ok: false, reason: 'invalid' });
  });

  it('only ever produces what the database check accepts', () => {
    for (const raw of ['+1 416 555 0123', '0044 7911 123456', '+61 412 345 678']) {
      const parsed = parsePhone(raw);
      expect(parsed.ok && E164.test(parsed.e164)).toBe(true);
    }
  });
});

describe('phoneError', () => {
  it('offers the +1 version when there is one', () => {
    expect(phoneError({ ok: false, reason: 'missing_country_code', suggestion: '+14165550123' })).toBe(
      'Add the country code. Did you mean +1 416-555-0123?'
    );
  });
});

describe('phoneFromDevice', () => {
  it('takes a local North American number as +1 and drops what it cannot place', () => {
    expect(phoneFromDevice('(416) 555-0123')).toBe('+14165550123');
    expect(phoneFromDevice('+44 7911 123456')).toBe('+447911123456');
    expect(phoneFromDevice('07911 123456')).toBeNull();
    expect(phoneFromDevice(undefined)).toBeNull();
  });
});

describe('links', () => {
  it('dials the E.164 number and opens WhatsApp with digits only', () => {
    expect(telHref('+14165550123')).toBe('tel:+14165550123');
    expect(whatsAppHref('+14165550123')).toBe('https://wa.me/14165550123');
  });

  it('formats North American numbers for display and leaves others as stored', () => {
    expect(formatPhone('+14165550123')).toBe('+1 416-555-0123');
    expect(formatPhone('+447911123456')).toBe('+447911123456');
  });
});

describe('optionalPhoneSchema', () => {
  it('turns a blank field into null and a valid number into E.164', () => {
    expect(optionalPhoneSchema.parse('')).toBeNull();
    expect(optionalPhoneSchema.parse(undefined)).toBeNull();
    expect(optionalPhoneSchema.parse('+1 416 555 0123')).toBe('+14165550123');
  });

  it('rejects a number without a country code with the suggestion', () => {
    const result = optionalPhoneSchema.safeParse('4165550123');
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Add the country code. Did you mean +1 416-555-0123?');
  });
});
