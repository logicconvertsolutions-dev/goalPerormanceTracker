// Splits an import into Server Action calls. Next.js refuses an action body
// over 1 MB, and .vcf notes can make a contact a couple of KB, so batches are
// cut by size as well as count (the action's own 5,000 cap). Each call also
// counts against the hourly import rate limit, so batches stay as large as
// those two bounds allow.

export const MAX_CONTACTS_PER_CALL = 5000;
const MAX_BYTES_PER_CALL = 800_000; // headroom under the 1 MB body limit

export function batchContacts<T>(contacts: readonly T[]): T[][] {
  const encoder = new TextEncoder();
  const batches: T[][] = [];
  let current: T[] = [];
  let bytes = 0;

  for (const contact of contacts) {
    const size = encoder.encode(JSON.stringify(contact)).length + 1;
    if (current.length > 0 && (current.length >= MAX_CONTACTS_PER_CALL || bytes + size > MAX_BYTES_PER_CALL)) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(contact);
    bytes += size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}
