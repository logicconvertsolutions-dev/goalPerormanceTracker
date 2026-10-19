import { describe, expect, it } from 'vitest';
import { contactsHref, pageCount, parsePage } from './paging';

describe('parsePage', () => {
  it.each([
    [undefined, 1],
    ['', 1],
    ['0', 1],
    ['-2', 1],
    ['1.5', 1],
    ['abc', 1],
    ['3', 3],
  ])('%s -> %i', (raw, expected) => {
    expect(parsePage(raw)).toBe(expected);
  });
});

describe('pageCount', () => {
  it('is at least 1, even with no contacts', () => {
    expect(pageCount(0)).toBe(1);
  });
  it('rounds up a partial last page', () => {
    expect(pageCount(50)).toBe(1);
    expect(pageCount(51)).toBe(2);
    expect(pageCount(1234)).toBe(25);
  });
});

describe('contactsHref', () => {
  it('drops page 1 and an empty search', () => {
    expect(contactsHref(1)).toBe('/contacts');
  });
  it('keeps the search across pages', () => {
    expect(contactsHref(3, 'smith')).toBe('/contacts?q=smith&page=3');
    expect(contactsHref(1, 'smith')).toBe('/contacts?q=smith');
  });
});
