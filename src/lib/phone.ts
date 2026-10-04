import { z } from 'zod';

// Contact phone numbers (P33). Stored in E.164 only -- "+" then the country
// code and number, 8-15 digits, no spaces -- matching the database's
// contacts_phone_number_e164 check. WhatsApp's wa.me handoff needs the
// country code, so a number without one is refused at entry rather than
// guessed at later. No phone library (no new dependency): this is format
// checking, not carrier validation.

export const E164 = /^\+[1-9]\d{7,14}$/;

export type PhoneParse =
  | { ok: true; e164: string }
  | { ok: false; reason: 'missing_country_code'; suggestion: string | null }
  | { ok: false; reason: 'invalid' };

/**
 * Normalises what a person typed (or a device contact held) toward E.164.
 * Strips spaces, dashes, dots and brackets, and reads a leading "00" as "+".
 * A number with no country code isn't accepted as-is; when it looks North
 * American (10 digits, or 11 starting with 1) the "+1" version is offered as
 * `suggestion` so the form can ask "Did you mean ...?".
 */
export function parsePhone(raw: string): PhoneParse {
  const compact = raw.trim().replace(/[\s\-.() ]/g, '');
  const withPlus = compact.startsWith('00') ? `+${compact.slice(2)}` : compact;

  if (withPlus.startsWith('+')) {
    return E164.test(withPlus) ? { ok: true, e164: withPlus } : { ok: false, reason: 'invalid' };
  }
  if (!/^\d+$/.test(withPlus)) return { ok: false, reason: 'invalid' };
  if (withPlus.length === 10 && /^[2-9]/.test(withPlus)) {
    return { ok: false, reason: 'missing_country_code', suggestion: `+1${withPlus}` };
  }
  if (withPlus.length === 11 && withPlus.startsWith('1')) {
    return { ok: false, reason: 'missing_country_code', suggestion: `+${withPlus}` };
  }
  return { ok: false, reason: 'missing_country_code', suggestion: null };
}

/** The message a form shows for a number it can't accept. */
export function phoneError(parse: Exclude<PhoneParse, { ok: true }>): string {
  if (parse.reason === 'invalid') return 'Enter a valid phone number, e.g. +1 416 555 0123.';
  return parse.suggestion
    ? `Add the country code. Did you mean ${formatPhone(parse.suggestion)}?`
    : 'Add the country code, starting with + (e.g. +44 for the UK).';
}

/**
 * A number from the device's contact picker. Phones usually store local
 * numbers without "+1", so a North American-looking number is taken as
 * +1 here (the import toast says so); anything still ambiguous is dropped
 * and the contact is imported by name only.
 */
export function phoneFromDevice(raw: string | undefined): string | null {
  if (!raw) return null;
  const parsed = parsePhone(raw);
  if (parsed.ok) return parsed.e164;
  return parsed.reason === 'missing_country_code' ? parsed.suggestion : null;
}

/** Display form: "+1 416-555-0123" for North America, the stored E.164
 * otherwise (formatting every country's grouping would need a library). */
export function formatPhone(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `+1 ${m[1]}-${m[2]}-${m[3]}` : e164;
}

export function telHref(e164: string): string {
  return `tel:${e164}`;
}

/** wa.me opens a chat with the number (digits only, no "+"). There is no
 * link that starts a WhatsApp voice call to a personal number -- wa.me/call
 * is for the Business Calling API only -- so the agent taps call in the
 * chat themselves. */
export function whatsAppHref(e164: string): string {
  return `https://wa.me/${e164.replace(/\D/g, '')}`;
}

/** Optional phone field for Server Action schemas: blank -> null, anything
 * else must parse to E.164 (the value is replaced by the normalised form). */
export const optionalPhoneSchema = z
  .string()
  .optional()
  .transform((value, ctx) => {
    if (!value?.trim()) return null;
    const parsed = parsePhone(value);
    if (parsed.ok) return parsed.e164;
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: phoneError(parsed) });
    return z.NEVER;
  });
