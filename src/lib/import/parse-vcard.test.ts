import { describe, expect, it } from 'vitest';
import { parseVCard } from './parse-vcard';

const crlf = (lines: string[]) => lines.join('\r\n');

describe('parseVCard', () => {
  it('reads an Android vCard 2.1 export, quoted-printable names included', () => {
    const file = crlf([
      'BEGIN:VCARD',
      'VERSION:2.1',
      'N:Doe;Jane;;;',
      'FN:Jane Doe',
      'TEL;CELL:416-555-0123',
      'TEL;HOME:+44 20 7946 0958',
      'END:VCARD',
      'BEGIN:VCARD',
      'VERSION:2.1',
      'N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Mu=C3=B1oz;Jos=C3=A9;;;',
      'FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Jos=C3=A9 Mu=C3=B1oz',
      'TEL;CELL;PREF:+52 55 1234 5678',
      'END:VCARD',
    ]);

    expect(parseVCard(file)).toEqual({
      contacts: [
        { fullName: 'Jane Doe', phoneNumber: '+14165550123', notes: null },
        { fullName: 'José Muñoz', phoneNumber: '+525512345678', notes: null },
      ],
      skippedNoName: 0,
      droppedNumbers: 0,
    });
  });

  it('joins quoted-printable soft line breaks', () => {
    const file = crlf([
      'BEGIN:VCARD',
      'VERSION:2.1',
      'FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:=E5=BC=A0=E4=BC=9F=20=',
      'Smith',
      'END:VCARD',
    ]);
    expect(parseVCard(file).contacts).toEqual([{ fullName: '张伟 Smith', phoneNumber: null, notes: null }]);
  });

  it('reads vCard 3.0 (iOS) with grouped properties, folding, escapes and a photo', () => {
    const file = crlf([
      'BEGIN:VCARD',
      'VERSION:3.0',
      'PRODID:-//Apple Inc.//iPhone OS 17.0//EN',
      'N:O\\,Brien;Pat;;;',
      'FN:Pat O\\,Brien',
      'item1.TEL;type=CELL;type=VOICE;type=pref:(647) 555-0199',
      'PHOTO;ENCODING=b;TYPE=JPEG:/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/',
      ' 2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy',
      'END:VCARD',
      'BEGIN:VCARD',
      'VERSION:3.0',
      'FN:A Very Long Na',
      ' me Folded',
      'END:VCARD',
    ]);

    expect(parseVCard(file).contacts).toEqual([
      { fullName: 'Pat O,Brien', phoneNumber: '+16475550199', notes: null },
      { fullName: 'A Very Long Name Folded', phoneNumber: null, notes: null },
    ]);
  });

  it('reads vCard 4.0 tel: URIs, and prefers a Canadian/US number over PREF=1', () => {
    const file = [
      'BEGIN:VCARD',
      'VERSION:4.0',
      'FN:Sam Lee',
      'TEL;VALUE=uri;TYPE=home:tel:+1-905-555-0100',
      'TEL;VALUE=uri;PREF=1;TYPE="voice,cell":tel:+61-2-9876-5432',
      'END:VCARD',
    ].join('\n');
    expect(parseVCard(file).contacts).toEqual([{ fullName: 'Sam Lee', phoneNumber: '+19055550100', notes: null }]);
  });

  it('falls back to N when FN is missing, and skips cards with no name', () => {
    const file = crlf([
      'BEGIN:VCARD',
      'VERSION:3.0',
      'N:Nguyen;Linh;;Dr.;',
      'END:VCARD',
      'BEGIN:VCARD',
      'VERSION:3.0',
      'TEL:+14165550000',
      'END:VCARD',
    ]);
    expect(parseVCard(file)).toEqual({
      contacts: [{ fullName: 'Dr. Linh Nguyen', phoneNumber: null, notes: null }],
      skippedNoName: 1,
      droppedNumbers: 0,
    });
  });

  it('keeps the first number it can place, and counts contacts whose numbers it cannot', () => {
    const file = crlf([
      'BEGIN:VCARD',
      'FN:Two Numbers',
      'TEL:12345',
      'TEL:6475550142',
      'END:VCARD',
      'BEGIN:VCARD',
      'FN:Local Only',
      'TEL:020 7946 0958',
      'END:VCARD',
    ]);
    expect(parseVCard(file)).toEqual({
      contacts: [
        { fullName: 'Two Numbers', phoneNumber: '+16475550142', notes: null },
        { fullName: 'Local Only', phoneNumber: null, notes: null },
      ],
      skippedNoName: 0,
      droppedNumbers: 1,
    });
  });

  it('takes PREF first among numbers of the same kind', () => {
    const file = crlf([
      'BEGIN:VCARD',
      'FN:Abroad',
      'TEL;HOME:+44 20 7946 0958',
      'TEL;CELL;PREF:+61 2 9876 5432',
      'END:VCARD',
    ]);
    expect(parseVCard(file).contacts[0].phoneNumber).toBe('+61298765432');
  });

  it('does not invent a +1 number from a 10-digit number with an unused area code', () => {
    const file = crlf(['BEGIN:VCARD', 'FN:Priya Shah', 'TEL;CELL:98765 43210', 'END:VCARD']);
    expect(parseVCard(file)).toEqual({
      contacts: [{ fullName: 'Priya Shah', phoneNumber: null, notes: null }],
      skippedNoName: 0,
      droppedNumbers: 1,
    });
  });

  it('reads NOTE across vCard versions: escapes, folding, quoted-printable and the length cap', () => {
    const file = crlf([
      'BEGIN:VCARD',
      'VERSION:3.0',
      'FN:Three Point Oh',
      'NOTE:Met at church\\, wants a call\\nafter 6pm',
      'END:VCARD',
      'BEGIN:VCARD',
      'VERSION:2.1',
      'FN:Two Point One',
      'NOTE;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Caf=C3=A9 owner=0D=0A=',
      'Spouse: Ana',
      'END:VCARD',
      'BEGIN:VCARD',
      'VERSION:4.0',
      'FN:Four Point Oh',
      'NOTE:Referred by',
      '  Raj',
      'END:VCARD',
      'BEGIN:VCARD',
      'FN:Long Note',
      `NOTE:${'x'.repeat(2500)}`,
      'END:VCARD',
      'BEGIN:VCARD',
      'FN:Blank Note',
      'NOTE:   ',
      'END:VCARD',
    ]);
    const notes = parseVCard(file).contacts.map((c) => c.notes);
    expect(notes).toEqual([
      'Met at church, wants a call\nafter 6pm',
      'Café owner\nSpouse: Ana',
      'Referred by Raj',
      'x'.repeat(2000),
      null,
    ]);
  });

  it('returns nothing for a file that is not a vCard', () => {
    expect(parseVCard('Name,Phone\nJane,123')).toEqual({ contacts: [], skippedNoName: 0, droppedNumbers: 0 });
  });
});
