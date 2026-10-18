import { describe, expect, it } from 'vitest';
import { fakeClient } from '@/test/fake-supabase';
import { saveContacts } from './save-contacts';

const AGENT_ID = 'agent-1';
const ORG_ID = 'org-1';

function seed(fake: ReturnType<typeof fakeClient>['fake'], count: number, prefix = 'Existing') {
  for (let i = 0; i < count; i++) {
    fake.tables.contacts.push({
      id: `seed-${String(i).padStart(5, '0')}`,
      agent_id: AGENT_ID,
      org_id: ORG_ID,
      full_name: `${prefix} ${i}`,
      phone_number: null,
      notes: null,
    });
  }
}

describe('saveContacts', () => {
  // 2026-10-17: agents with 1,000+ contacts got almost nothing imported --
  // the existing-contact read stopped at PostgREST's 1000-row cap, so names
  // past it were re-inserted and each collision sank its whole 200-row chunk.
  it('sees every existing contact past the 1000-row cap and only creates the new ones', async () => {
    const { client, fake } = fakeClient();
    seed(fake, 2500);

    const inputs = [
      ...Array.from({ length: 2500 }, (_, i) => ({ fullName: `Existing ${i}`, phoneNumber: null })),
      ...Array.from({ length: 300 }, (_, i) => ({ fullName: `New ${i}`, phoneNumber: null })),
    ];
    const result = await saveContacts(client, AGENT_ID, ORG_ID, inputs);

    expect(result).toMatchObject({ created: 300, existing: 2500, failed: 0 });
    expect(fake.tables.contacts).toHaveLength(2800);
    expect(result.idsByName.get('existing 2400')).toBe('seed-02400');
  });

  it('retries a chunk row by row when one name collides, saving the rest', async () => {
    const { client, fake } = fakeClient();
    const inputs = Array.from({ length: 200 }, (_, i) => ({ fullName: `Person ${i}`, phoneNumber: null }));

    // Someone else saves "Person 7" between the read and the insert.
    const original = fake.from.bind(fake);
    let raced = false;
    fake.from = (table: string) => {
      const query = original(table);
      if (table === 'contacts' && !raced) {
        const insert = query.insert.bind(query);
        query.insert = (rows) => {
          if (Array.isArray(rows) && rows.length > 1) {
            raced = true;
            fake.tables.contacts.push({ id: 'other', agent_id: AGENT_ID, org_id: ORG_ID, full_name: 'Person 7' });
          }
          return insert(rows);
        };
      }
      return query;
    };

    const result = await saveContacts(client, AGENT_ID, ORG_ID, inputs);

    expect(result).toMatchObject({ created: 199, existing: 1, failed: 0 });
    expect(result.idsByName.get('person 7')).toBe('other');
    expect(fake.tables.contacts).toHaveLength(200);
  });

  it('collapses names repeated in one import and matches case-insensitively', async () => {
    const { client, fake } = fakeClient();
    fake.tables.contacts.push({ id: 'jd', agent_id: AGENT_ID, org_id: ORG_ID, full_name: 'Jane Doe' });

    const result = await saveContacts(client, AGENT_ID, ORG_ID, [
      { fullName: 'jane doe', phoneNumber: null },
      { fullName: 'Sam Lee', phoneNumber: null },
      { fullName: 'SAM LEE', phoneNumber: '+14165550123' },
      { fullName: '   ', phoneNumber: null },
    ]);

    expect(result).toMatchObject({ created: 1, existing: 1, failed: 0 });
    expect(fake.tables.contacts.find((c) => c.full_name === 'Sam Lee')?.phone_number).toBe('+14165550123');
  });

  it('saves notes on new contacts and fills empty ones, never replacing what the agent wrote', async () => {
    const { client, fake } = fakeClient();
    fake.tables.contacts.push(
      { id: 'empty', agent_id: AGENT_ID, org_id: ORG_ID, full_name: 'Empty Notes', phone_number: null, notes: null },
      { id: 'kept', agent_id: AGENT_ID, org_id: ORG_ID, full_name: 'Has Notes', phone_number: null, notes: 'Mine' }
    );

    await saveContacts(client, AGENT_ID, ORG_ID, [
      { fullName: 'Empty Notes', phoneNumber: null, notes: 'From phone' },
      { fullName: 'Has Notes', phoneNumber: null, notes: 'From phone' },
      { fullName: 'Brand New', phoneNumber: null, notes: 'Met at church' },
    ]);

    const byName = (name: string) => fake.tables.contacts.find((c) => c.full_name === name);
    expect(byName('Empty Notes')?.notes).toBe('From phone');
    expect(byName('Has Notes')?.notes).toBe('Mine');
    expect(byName('Brand New')?.notes).toBe('Met at church');
  });
});
