import { pickDevicePhone } from '@/lib/phone';

// vCard (.vcf) contact files -- the bulk path for Android, whose browser
// contact picker only ticks contacts one at a time. The Contacts app exports
// the whole address book (or a selection) to one .vcf in a few taps.
//
// Runs in the browser, not a Server Action: an export with contact photos is
// easily several MB, well past the Server Action body limit, while the
// name + number this keeps is a few dozen bytes per contact. The result goes
// through importDeviceContactsAction, which re-validates it, exactly like the
// picker's.
//
// Covers vCard 2.1 (Android's export: QUOTED-PRINTABLE + CHARSET for
// non-ASCII names, bare TYPE params, "=" soft line breaks), 3.0 (iOS/macOS,
// Google Contacts) and 4.0 (tel: URIs, PREF=1). No dependency: only FN, N,
// TEL and NOTE are read, everything else (PHOTO, EMAIL, ADR, ORG...) is
// skipped.

export interface VCardContact {
  fullName: string;
  /** E.164, normalised the same way as a picked device contact. */
  phoneNumber: string | null;
  /** The card's own notes (NOTE), trimmed to the contacts.notes limit. */
  notes: string | null;
}

export interface VCardParseResult {
  contacts: VCardContact[];
  /** Cards with no usable name -- a number alone can't become a contact. */
  skippedNoName: number;
  /** Cards that had a number we couldn't place (no country code and not
   * North American); those contacts come in by name only. */
  droppedNumbers: number;
}

export const MAX_NAME_LENGTH = 200; // importDeviceContactsAction's schema bound
export const MAX_NOTES_LENGTH = 2000; // same bound as the contact form's notes

interface Property {
  name: string;
  params: string[];
  value: string;
}

export function parseVCard(text: string): VCardParseResult {
  const result: VCardParseResult = { contacts: [], skippedNoName: 0, droppedNumbers: 0 };
  let card: Property[] | null = null;

  for (const line of logicalLines(text)) {
    const prop = parseLine(line);
    if (!prop) continue;

    if (prop.name === 'BEGIN' && prop.value.trim().toUpperCase() === 'VCARD') {
      card = [];
    } else if (prop.name === 'END' && prop.value.trim().toUpperCase() === 'VCARD') {
      if (card) addCard(card, result);
      card = null;
    } else if (card && (prop.name === 'FN' || prop.name === 'N' || prop.name === 'TEL' || prop.name === 'NOTE')) {
      card.push(prop);
    }
  }

  return result;
}

function addCard(card: Property[], result: VCardParseResult): void {
  const fullName = nameFor(card);
  if (!fullName) {
    result.skippedNoName += 1;
    return;
  }

  const tels = card.filter((p) => p.name === 'TEL');
  // Preferred number first, otherwise the card's own order; pickDevicePhone
  // then prefers a Canadian/US number and skips any it can't place.
  const ordered = [...tels.filter(isPreferred), ...tels.filter((p) => !isPreferred(p))];
  const phoneNumber = pickDevicePhone(ordered.map((tel) => decodeValue(tel).replace(/^tel:/i, '')));
  if (!phoneNumber && tels.length > 0) result.droppedNumbers += 1;

  result.contacts.push({ fullName, phoneNumber, notes: notesFor(card) });
}

/** Every NOTE on the card, joined; line breaks kept (unlike in a name). */
function notesFor(card: Property[]): string | null {
  const notes = card
    .filter((p) => p.name === 'NOTE')
    .map((p) => unescapeNote(decodeValue(p)).trim())
    .filter(Boolean)
    .join('\n');
  return cleanNotes(notes);
}

function nameFor(card: Property[]): string | null {
  const fn = card.find((p) => p.name === 'FN');
  const formatted = fn ? cleanName(unescapeText(decodeValue(fn))) : '';
  if (formatted) return formatted;

  // N is family;given;additional;prefix;suffix
  const n = card.find((p) => p.name === 'N');
  if (!n) return null;
  const [family = '', given = '', additional = '', prefix = '', suffix = ''] = splitUnescaped(decodeValue(n), ';').map(
    (part) => unescapeText(part).trim()
  );
  return cleanName([prefix, given, additional, family, suffix].filter(Boolean).join(' ')) || null;
}

/** One line, single spaces, at most MAX_NAME_LENGTH -- shared with the phone
 * picker so both import paths send the server the same shape of name. */
export function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH).trim();
}

/** Trimmed, at most MAX_NOTES_LENGTH, null when empty. */
export function cleanNotes(notes: string | null | undefined): string | null {
  const trimmed = (notes ?? '').replace(/\r\n?/g, '\n').trim().slice(0, MAX_NOTES_LENGTH).trim();
  return trimmed || null;
}

function isPreferred(prop: Property): boolean {
  return prop.params.some((p) => {
    const upper = p.toUpperCase();
    return upper === 'PREF' || upper === 'PREF=1' || /^TYPE=.*\bPREF\b/.test(upper);
  });
}

/**
 * Splits the file into one string per property: joins vCard 2.1
 * quoted-printable soft line breaks (a QP line ending in "="), then unfolds
 * continuation lines (a line starting with a space or tab belongs to the one
 * before it).
 */
function logicalLines(text: string): string[] {
  const physical = text.replace(/^﻿/, '').split(/\r\n|\r|\n/);
  const lines: string[] = [];

  for (let i = 0; i < physical.length; i++) {
    let line = physical[i];

    if (/^[ \t]/.test(line) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
      continue;
    }

    if (isQuotedPrintable(line)) {
      while (line.endsWith('=') && i + 1 < physical.length) {
        line = line.slice(0, -1) + physical[++i].replace(/^[ \t]+/, '');
      }
    }
    lines.push(line);
  }

  return lines;
}

function isQuotedPrintable(line: string): boolean {
  const colon = line.indexOf(':');
  return colon > 0 && /QUOTED-PRINTABLE/i.test(line.slice(0, colon));
}

function parseLine(line: string): Property | null {
  // The first ":" outside a quoted parameter value separates name;params from
  // the value.
  let inQuotes = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ':' && !inQuotes) {
      colon = i;
      break;
    }
  }
  if (colon <= 0) return null;

  const [rawName, ...params] = line.slice(0, colon).split(';');
  // Drop a group prefix ("item1.TEL" -> "TEL").
  const name = rawName.slice(rawName.lastIndexOf('.') + 1).trim().toUpperCase();
  return { name, params: params.map((p) => p.trim()), value: line.slice(colon + 1) };
}

function paramValue(prop: Property, key: string): string | null {
  const prefix = `${key}=`;
  const found = prop.params.find((p) => p.toUpperCase().startsWith(prefix));
  return found ? found.slice(prefix.length).replace(/^"|"$/g, '') : null;
}

/** Applies ENCODING (quoted-printable or base64) and CHARSET. */
function decodeValue(prop: Property): string {
  const encoding = (paramValue(prop, 'ENCODING') ?? '').toUpperCase();
  const bareQp = prop.params.some((p) => p.toUpperCase() === 'QUOTED-PRINTABLE');
  const charset = paramValue(prop, 'CHARSET') ?? 'utf-8';

  if (encoding === 'QUOTED-PRINTABLE' || bareQp) return decodeBytes(quotedPrintableBytes(prop.value), charset);
  if (encoding === 'B' || encoding === 'BASE64') {
    try {
      const binary = atob(prop.value.replace(/\s+/g, ''));
      return decodeBytes(Uint8Array.from(binary, (c) => c.charCodeAt(0)), charset);
    } catch {
      return '';
    }
  }
  return prop.value;
}

function quotedPrintableBytes(value: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < value.length; i++) {
    const hex = value.slice(i + 1, i + 3);
    if (value[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(hex)) {
      bytes.push(parseInt(hex, 16));
      i += 2;
    } else {
      // Literal characters in a QP value are ASCII; encode anything else as
      // UTF-8 rather than truncating it.
      bytes.push(...new TextEncoder().encode(value[i]));
    }
  }
  return Uint8Array.from(bytes);
}

function decodeBytes(bytes: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/** Splits on `sep` where it isn't backslash-escaped. */
function splitUnescaped(value: string, sep: string): string[] {
  const parts: string[] = [];
  let current = '';
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '\\' && i + 1 < value.length) {
      current += value[i] + value[i + 1];
      i += 1;
    } else if (value[i] === sep) {
      parts.push(current);
      current = '';
    } else {
      current += value[i];
    }
  }
  parts.push(current);
  return parts;
}

function unescapeNote(value: string): string {
  return value.replace(/\\([nN,;:\\])/g, (_, ch: string) => (ch === 'n' || ch === 'N' ? '\n' : ch));
}

function unescapeText(value: string): string {
  return value.replace(/\\([nN,;:\\])/g, (_, ch: string) => (ch === 'n' || ch === 'N' ? ' ' : ch));
}
