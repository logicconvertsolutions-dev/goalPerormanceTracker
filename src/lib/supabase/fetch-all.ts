// PostgREST caps every response at the project's max_rows (1000), and says
// nothing when it does -- the response just stops. Anything that must return
// *every* row (the data export, not a paged screen) reads through this.
export const PAGE_SIZE = 1000;

type PageResult<T> = PromiseLike<{ data: T[] | null; error: unknown }>;

/**
 * Reads every row by calling `page(from, to)` for consecutive inclusive
 * ranges until a short page comes back. The caller's query must have a
 * stable, unique `.order(...)` or rows can repeat or go missing between
 * pages. Throws on the first error rather than returning a partial result.
 */
export async function fetchAllPages<T>(
  page: (from: number, to: number) => PageResult<T>
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return rows;
  }
}
