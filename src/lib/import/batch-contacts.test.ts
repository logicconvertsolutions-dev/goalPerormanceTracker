import { describe, expect, it } from 'vitest';
import { batchContacts } from './batch-contacts';

describe('batchContacts', () => {
  it('keeps an ordinary list in one call', () => {
    const contacts = Array.from({ length: 1500 }, (_, i) => ({ fullName: `Person ${i}`, phoneNumber: '+14165550123' }));
    expect(batchContacts(contacts)).toHaveLength(1);
  });

  it('splits by count and by size, keeping order and every contact', () => {
    const many = Array.from({ length: 12000 }, (_, i) => ({ fullName: `P${i}` }));
    expect(batchContacts(many).map((b) => b.length)).toEqual([5000, 5000, 2000]);

    const heavy = Array.from({ length: 1000 }, (_, i) => ({ fullName: `P${i}`, notes: 'x'.repeat(2000) }));
    const batches = batchContacts(heavy);
    expect(batches.length).toBeGreaterThan(2);
    for (const b of batches) expect(new TextEncoder().encode(JSON.stringify(b)).length).toBeLessThan(1_000_000);
    expect(batches.flat()).toEqual(heavy);
  });
});
