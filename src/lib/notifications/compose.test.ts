// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../../types/database';
import { composeCycleDigest, buildDigestCallouts, type NotifiableAgent, type DigestAgentInput } from './compose';

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

interface SummaryRow {
  agent_id: string;
  full_name: string;
  calls_made: number;
  calls_target: number;
  appts_set: number;
  appts_held: number;
  appts_held_target: number;
  premium_cents: number;
  premium_cents_target: number;
}

interface MetricRow {
  agent_id: string;
  activity_date: string;
  calls_made?: number;
  appts_set?: number;
  sales_count?: number;
  recruiting_convos?: number;
  appt_held?: number;
  referrals_given?: number;
}

const row = (over: Partial<SummaryRow> & { agent_id: string; full_name: string }): SummaryRow => ({
  calls_made: 0,
  calls_target: 200,
  appts_set: 0,
  appts_held: 0,
  appts_held_target: 20,
  premium_cents: 0,
  premium_cents_target: 1_000_000,
  ...over,
});

/**
 * Admin-client stub. composeCycleDigest makes exactly two kinds of call:
 * `.rpc('system_team_period_summary', ...)`, keyed here by the `from:to`
 * window, and `.from('daily_metrics').select(...).in(...).gte(...).lte(...)`,
 * which the chainable below filters in memory.
 */
function stubAdmin(rowsByWindow: Record<string, SummaryRow[]>, metrics: MetricRow[] = []) {
  const windowsAsked: string[] = [];
  const rpc = vi.fn(async (_fn: string, args: { p_from: string; p_to: string }) => {
    const key = `${args.p_from}:${args.p_to}`;
    windowsAsked.push(key);
    return { data: rowsByWindow[key] ?? [], error: null };
  });

  const from = vi.fn(() => {
    let ids: string[] = [];
    let gte = '0000-00-00';
    let lte = '9999-99-99';
    const chain = {
      select: () => chain,
      in: (_col: string, v: string[]) => { ids = v; return chain; },
      gte: (_col: string, v: string) => { gte = v; return chain; },
      lte: (_col: string, v: string) => { lte = v; return chain; },
      // awaited at the end of the builder chain
      then: (resolve: (r: { data: MetricRow[] }) => unknown) =>
        resolve({
          data: metrics
            .filter((m) => ids.includes(m.agent_id) && m.activity_date >= gte && m.activity_date <= lte)
            .map((m) => ({
              calls_made: 0, appts_set: 0, sales_count: 0, recruiting_convos: 0,
              appt_held: 0, referrals_given: 0, ...m,
            })),
        }),
    };
    return chain;
  });

  return { admin: { rpc, from } as unknown as SupabaseClient<Database>, windowsAsked };
}

describe('composeCycleDigest', () => {
  it('reports the cycle that just closed, not the one starting today', async () => {
    // Fires 8am on day 21 -- Sep 11-20 is the cycle with numbers in it;
    // Sep 21-30 is eight hours old and structurally empty.
    const { admin, windowsAsked } = stubAdmin(
      {
        '2026-09-11:2026-09-20': [
          row({ agent_id: 'a1', full_name: 'Jamie Lee', calls_made: 140, appts_set: 20, appts_held: 12, premium_cents: 250_000 }),
          row({ agent_id: 'a2', full_name: 'Sam Okoye', calls_made: 60, appts_set: 4, appts_held: 3 }),
        ],
        '2026-09-01:2026-09-10': [
          row({ agent_id: 'a1', full_name: 'Jamie Lee', calls_made: 90 }),
          row({ agent_id: 'a2', full_name: 'Sam Okoye', calls_made: 75 }),
        ],
        '2026-09-21:2026-09-30': [],
      },
      [
        { agent_id: 'a1', activity_date: '2026-09-20', calls_made: 10, sales_count: 3, recruiting_convos: 5 },
        { agent_id: 'a2', activity_date: '2026-09-19', calls_made: 6, recruiting_convos: 2 },
      ]
    );

    const result = await composeCycleDigest(admin, LEADER, '2026-09-21');

    expect(windowsAsked).toEqual(['2026-09-11:2026-09-20', '2026-09-01:2026-09-10']);
    expect(windowsAsked).not.toContain('2026-09-21:2026-09-30');
    expect(result).not.toBeNull();
    expect(result!.content.subject).toBe('Your team cycle digest — Sep 11-20');
    expect(result!.content.text).toContain('Calls        200 (50% of 400');
  });

  it('carries recruiting conversations and sales through from daily_metrics', async () => {
    const { admin } = stubAdmin(
      {
        '2026-09-11:2026-09-20': [row({ agent_id: 'a1', full_name: 'Jamie Lee', calls_made: 140, appts_set: 10, appts_held: 8 })],
        '2026-09-01:2026-09-10': [],
      },
      [
        { agent_id: 'a1', activity_date: '2026-09-12', recruiting_convos: 4, sales_count: 1 },
        { agent_id: 'a1', activity_date: '2026-09-15', recruiting_convos: 3, sales_count: 2 },
        // Outside the reported cycle -- must not be counted in the totals.
        { agent_id: 'a1', activity_date: '2026-09-25', recruiting_convos: 99, sales_count: 99 },
      ]
    );

    const result = await composeCycleDigest(admin, LEADER, '2026-09-21');

    expect(result!.content.text).toContain('Recruiting   7 conversations');
    expect(result!.content.text).toContain('Sales        3');
    expect(result!.content.text).not.toContain('99');
  });

  it('steps back into the previous month on the first day of a month', async () => {
    const { admin, windowsAsked } = stubAdmin({
      '2026-08-21:2026-08-31': [row({ agent_id: 'a1', full_name: 'Jamie Lee', calls_made: 110 })],
      '2026-08-11:2026-08-20': [],
    });

    const result = await composeCycleDigest(admin, LEADER, '2026-09-01');

    expect(windowsAsked).toEqual(['2026-08-21:2026-08-31', '2026-08-11:2026-08-20']);
    expect(result!.content.text).toContain('Cycle Aug 21-31 is closed');
  });

  it('sends nothing when the leader has no downline', async () => {
    const { admin } = stubAdmin({});
    expect(await composeCycleDigest(admin, LEADER, '2026-09-21')).toBeNull();
  });
});

const agent = (over: Partial<DigestAgentInput> & { agentId: string; name: string }): DigestAgentInput => ({
  calls: 200, callsTarget: 200, apptsSet: 20, apptsHeld: 18, sales: 4,
  premiumCents: 0, recruits: 2, priorCalls: 200, lastActiveIso: '2026-09-20',
  ...over,
});

describe('buildDigestCallouts', () => {
  const asOf = '2026-09-21';

  it('flags a silent agent first, and says what they did last cycle', () => {
    const { attention } = buildDigestCallouts(
      [
        agent({ agentId: 'a1', name: 'Jamie Lee' }),
        agent({ agentId: 'a2', name: 'Marcus Webb', calls: 0, priorCalls: 33, lastActiveIso: '2026-09-04' }),
      ],
      asOf
    );

    expect(attention[0].name).toBe('Marcus Webb');
    expect(attention[0].reason).toBe('0 of 200 calls');
    expect(attention[0].severe).toBe(true);
    expect(attention[0].hint).toContain('33 calls last cycle');
  });

  it('names the appointment drop-off rather than the call count when calls are fine', () => {
    const { attention } = buildDigestCallouts(
      [agent({ agentId: 'a1', name: 'Tom Alvarez', apptsSet: 9, apptsHeld: 2 })],
      asOf
    );
    expect(attention[0].reason).toBe('9 appts set, only 2 held');
    expect(attention[0].severe).toBe(false);
  });

  it('flags a low set rate only above a real call volume', () => {
    const busy = buildDigestCallouts([agent({ agentId: 'a1', name: 'Sam Okoye', calls: 214, callsTarget: 200, apptsSet: 6, apptsHeld: 6 })], asOf);
    expect(busy.attention[0].reason).toContain('3% set rate');

    // Same ratio, trivial volume -- not worth a callout.
    const quiet = buildDigestCallouts([agent({ agentId: 'a1', name: 'Sam Okoye', calls: 20, callsTarget: 20, apptsSet: 0, apptsHeld: 0 })], asOf);
    expect(quiet.attention).toHaveLength(0);
  });

  it('replaces per-person callouts with a team banner when everyone is under target', () => {
    const { banner, attention } = buildDigestCallouts(
      [
        agent({ agentId: 'a1', name: 'One', calls: 14, callsTarget: 80, priorCalls: 37 }),
        agent({ agentId: 'a2', name: 'Two', calls: 8, callsTarget: 35, priorCalls: 26 }),
        agent({ agentId: 'a3', name: 'Three', calls: 3, callsTarget: 150, priorCalls: 6 }),
      ],
      asOf
    );

    expect(banner).not.toBeNull();
    expect(banner!.title).toBe('Every one of the 3 is under 60% of their call target.');
    expect(banner!.body).toContain('25 calls against 265');
    expect(banner!.body).toContain('not 3 separate performance conversations');
    // The individual list still stands -- the banner frames it, not replaces
    // it -- ordered by how far under target each one is: 2%, 18%, 23%.
    expect(attention.map((a) => a.name)).toEqual(['Three', 'One', 'Two']);
  });

  it('raises no banner when the misses are a minority', () => {
    const { banner } = buildDigestCallouts(
      [
        agent({ agentId: 'a1', name: 'One' }),
        agent({ agentId: 'a2', name: 'Two' }),
        agent({ agentId: 'a3', name: 'Three', calls: 10 }),
      ],
      asOf
    );
    expect(banner).toBeNull();
  });

  it('caps the attention list rather than naming everybody', () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      agent({ agentId: `a${i}`, name: `Agent ${i}`, calls: i, callsTarget: 200 })
    );
    expect(buildDigestCallouts(many, asOf).attention).toHaveLength(5);
  });

  it('ranks movers by call delta and marks a lone mover as such', () => {
    const { movers } = buildDigestCallouts(
      [
        agent({ agentId: 'a1', name: 'Rae Tran', calls: 96, priorCalls: 0, premiumCents: 250_000 }),
        agent({ agentId: 'a2', name: 'Flat', calls: 50, priorCalls: 50 }),
        agent({ agentId: 'a3', name: 'Down', calls: 10, priorCalls: 90 }),
      ],
      asOf
    );
    expect(movers).toHaveLength(1);
    expect(movers[0].name).toBe('Rae Tran');
    expect(movers[0].note).toBe('+96 calls and $2,500 premium — the only positive move on the team');
  });

  it('calls out silence by date once it passes the stale threshold', () => {
    const { attention } = buildDigestCallouts(
      [agent({ agentId: 'a1', name: 'Gopinadh', calls: 3, callsTarget: 150, priorCalls: 6, lastActiveIso: '2026-09-12' })],
      asOf
    );
    expect(attention[0].hint).toBe('Nothing logged since Sep 12');
  });
});
