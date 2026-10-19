// Contacts screen paging (P42). The page number lives in the URL (`?page=`),
// like every other piece of screen state (CLAUDE.md conventions).
export const CONTACTS_PAGE_SIZE = 50;

/** `?page=` -> a 1-based page number; anything unusable is page 1. */
export function parsePage(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

export function pageCount(total: number, pageSize = CONTACTS_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** The /contacts URL for a page, keeping the search. Page 1 has no `page`. */
export function contactsHref(page: number, q?: string): string {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (page > 1) params.set('page', String(page));
  const qs = params.toString();
  return qs ? `/contacts?${qs}` : '/contacts';
}
