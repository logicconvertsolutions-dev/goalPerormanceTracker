// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../../types/database';
import { composeCycleDigest, type NotifiableAgent } from './compose';

interface SummaryRow {
  agent_id: string;
  full_name: string;
  calls_made: number;
  calls_target: number;
  premium_cents: number;
}

// The email footer signs an unsubscribe link on every compose -- same stub
// secret unsubscribe-token.test.ts uses.
beforeAll(() => {
  process.env.NOTIFICATIONS_UNSUB_SECRET = 'test-secret-do-not-use-in-production';
});

const LEADER: NotifiableAgent = {
  id: 'leader-1',
  email: 'smd@example.com',
  full_name: 'Dana Reyes',
  time_zone: 'America/Toronto',
};

/**
 * Minimal admin-client stub: composeCycleDigest only ever calls
 * `.rpc('system_team_period_summary', ...)`, so the stub keys canned rows by
 * the `from:to` window the call asks for and records every window it saw.
 */
function stubAdmin(rowsByWindow: Record<string, SummaryRow[]>) {
  const windowsAsked: string[] = [];
  const rpc = vi.fn(async (_fn: string, args: { p_from: string; p_to: string }) => {
    const key = `${args.p_from}:${args.p_to}`;
    windowsAsked.push(key);
    return { data: rowsByWindow[key] ?? [], error: null };
  });
  return { admin: { rpc } as unknown as SupabaseClient<Database>, rpc, windowsAsked };
}

const row = (over: Partial<SummaryRow> & { agent_id: string; full_name: string }): SummaryRow => ({
  calls_made: 0,
  calls_target: 200,
  premium_cents: 0,
  ...over,
});

describe('composeCycleDigest', () => {
  it('reports the cycle that just closed, not the one starting today', async () => {
    // Fires 8am on day 21 -- the Sep 11-20 cycle is the one with numbers in
    // it; Sep 21-30 is eight hours old and structurally empty.
    const { admin, windowsAsked } = stubAdmin({
      '2026-09-11:2026-09-20': [
        row({ agent_id: 'a1', full_name: 'Jamie Lee', calls_made: 140, premium_cents: 250_000 }),
        row({ agent_id: 'a2', full_name: 'Sam Okoye', calls_made: 60 }),
      ],
      '2026-09-01:2026-09-10': [
        row({ agent_id: 'a1', full_name: 'Jamie Lee', calls_made: 90 }),
        row({ agent_id: 'a2', full_name: 'Sam Okoye', calls_made: 75 }),
      ],
      '2026-09-21:2026-09-30': [],
    });

    const result = await composeCycleDigest(admin, LEADER, '2026-09-21');

    expect(windowsAsked).toEqual(['2026-09-11:2026-09-20', '2026-09-01:2026-09-10']);
    expect(windowsAsked).not.toContain('2026-09-21:2026-09-30');
    expect(result).not.toBeNull();
    expect(result!.content.text).toContain('Sep 11-20');
    expect(result!.content.text).toContain('200 of 400 calls');
    expect(result!.content.text).toContain('$2,500 in premium');
  });

  it('names only the agents who were quiet in the closed cycle', async () => {
    const { admin } = stubAdmin({
      '2026-09-11:2026-09-20': [
        row({ agent_id: 'a1', full_name: 'Jamie Lee', calls_made: 140 }),
        row({ agent_id: 'a2', full_name: 'Sam Okoye', calls_made: 0 }),
      ],
      '2026-09-01:2026-09-10': [],
    });

    const result = await composeCycleDigest(admin, LEADER, '2026-09-21');

    expect(result!.content.text).toContain('Quiet last cycle: Sam Okoye.');
    expect(result!.content.text).not.toContain('Jamie Lee,');
  });

  it('ranks movers against the cycle before the one being reported', async () => {
    const { admin } = stubAdmin({
      '2026-09-11:2026-09-20': [
        row({ agent_id: 'a1', full_name: 'Jamie Lee', calls_made: 140 }), // +50
        row({ agent_id: 'a2', full_name: 'Sam Okoye', calls_made: 80 }), // -20, not a mover
        row({ agent_id: 'a3', full_name: 'Rae Tran', calls_made: 120 }), // +120, no prior row
      ],
      '2026-09-01:2026-09-10': [
        row({ agent_id: 'a1', full_name: 'Jamie Lee', calls_made: 90 }),
        row({ agent_id: 'a2', full_name: 'Sam Okoye', calls_made: 100 }),
      ],
    });

    const result = await composeCycleDigest(admin, LEADER, '2026-09-21');

    expect(result!.content.text).toContain('Biggest movers vs. the cycle before: Rae Tran, Jamie Lee.');
  });

  it('steps back into the previous month on the first day of a month', async () => {
    // Day 1 -- the closed cycle is August's variable-length third chunk.
    const { admin, windowsAsked } = stubAdmin({
      '2026-08-21:2026-08-31': [row({ agent_id: 'a1', full_name: 'Jamie Lee', calls_made: 110 })],
      '2026-08-11:2026-08-20': [],
    });

    const result = await composeCycleDigest(admin, LEADER, '2026-09-01');

    expect(windowsAsked).toEqual(['2026-08-21:2026-08-31', '2026-08-11:2026-08-20']);
    expect(result!.content.text).toContain('Aug 21-31');
  });

  it('sends nothing when the leader has no downline', async () => {
    const { admin } = stubAdmin({});
    expect(await composeCycleDigest(admin, LEADER, '2026-09-21')).toBeNull();
  });
});
