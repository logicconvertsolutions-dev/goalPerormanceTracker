import { describe, expect, it, vi } from 'vitest';
import { fetchAllPages, PAGE_SIZE } from './fetch-all';

function rows(n: number, start = 0) {
  return Array.from({ length: n }, (_, i) => ({ id: start + i }));
}

describe('fetchAllPages', () => {
  it('keeps reading past the 1000-row cap until a short page', async () => {
    const page = vi.fn(async (from: number) => ({
      data: from === 0 ? rows(PAGE_SIZE) : rows(500, PAGE_SIZE),
      error: null,
    }));
    const all = await fetchAllPages(page);
    expect(all).toHaveLength(PAGE_SIZE + 500);
    expect(page).toHaveBeenNthCalledWith(1, 0, PAGE_SIZE - 1);
    expect(page).toHaveBeenNthCalledWith(2, PAGE_SIZE, 2 * PAGE_SIZE - 1);
  });

  it('makes one extra call when the total is an exact multiple of the page size', async () => {
    const page = vi.fn(async (from: number) => ({
      data: from === 0 ? rows(PAGE_SIZE) : [],
      error: null,
    }));
    expect(await fetchAllPages(page)).toHaveLength(PAGE_SIZE);
    expect(page).toHaveBeenCalledTimes(2);
  });

  it('treats null data as an empty page', async () => {
    expect(await fetchAllPages(async () => ({ data: null, error: null }))).toEqual([]);
  });

  it('throws instead of returning a partial result', async () => {
    const failure = { message: 'boom' };
    const page = vi.fn(async (from: number) =>
      from === 0 ? { data: rows(PAGE_SIZE), error: null } : { data: null, error: failure }
    );
    await expect(fetchAllPages(page)).rejects.toBe(failure);
  });
});
