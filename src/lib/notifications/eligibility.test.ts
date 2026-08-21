// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { agentsDueNow, type AgentForEligibility } from './eligibility';

// 2026-08-24 23:05 UTC = Monday 19:05 in America/New_York (evening_nudge window).
const MONDAY_EVENING = new Date('2026-08-24T23:05:00.000Z');
// 2026-08-24 12:05 UTC = Monday 08:05 in America/New_York (monday_digest window).
const MONDAY_MORNING = new Date('2026-08-24T12:05:00.000Z');

function associate(overrides: Partial<AgentForEligibility> = {}): AgentForEligibility {
  return {
    agentId: 'assoc-1',
    role: 'associate',
    timeZone: 'America/New_York',
    prefs: { eveningNudge: true, sundaySummary: true, mondayDigest: true },
    ...overrides,
  };
}

function leader(overrides: Partial<AgentForEligibility> = {}): AgentForEligibility {
  return {
    agentId: 'leader-1',
    role: 'leader',
    timeZone: 'America/New_York',
    prefs: { eveningNudge: true, sundaySummary: true, mondayDigest: true },
    ...overrides,
  };
}

describe('agentsDueNow', () => {
  it('sends evening_nudge to an associate in-window who has not logged today', () => {
    const due = agentsDueNow({
      agents: [associate()],
      now: MONDAY_EVENING,
      alreadySent: new Set(),
      loggedToday: new Set(),
    });
    expect(due).toEqual([{ agentId: 'assoc-1', kind: 'evening_nudge', localDateIso: '2026-08-24' }]);
  });

  it('skips evening_nudge for an associate who already logged today', () => {
    const due = agentsDueNow({
      agents: [associate()],
      now: MONDAY_EVENING,
      alreadySent: new Set(),
      loggedToday: new Set(['assoc-1']),
    });
    expect(due).toEqual([]);
  });

  it('skips evening_nudge when the preference is off', () => {
    const due = agentsDueNow({
      agents: [associate({ prefs: { eveningNudge: false, sundaySummary: true, mondayDigest: true } })],
      now: MONDAY_EVENING,
      alreadySent: new Set(),
      loggedToday: new Set(),
    });
    expect(due).toEqual([]);
  });

  it('skips a kind already recorded in notification_log for today', () => {
    const due = agentsDueNow({
      agents: [associate()],
      now: MONDAY_EVENING,
      alreadySent: new Set(['assoc-1:evening_nudge:2026-08-24']),
      loggedToday: new Set(),
    });
    expect(due).toEqual([]);
  });

  it('only sends monday_digest to leaders/admins, never associates', () => {
    const due = agentsDueNow({
      agents: [associate(), leader()],
      now: MONDAY_MORNING,
      alreadySent: new Set(),
      loggedToday: new Set(),
    });
    expect(due).toEqual([{ agentId: 'leader-1', kind: 'monday_digest', localDateIso: '2026-08-24' }]);
  });

  it('does not suppress monday_digest even if the leader logged something today', () => {
    const due = agentsDueNow({
      agents: [leader()],
      now: MONDAY_MORNING,
      alreadySent: new Set(),
      loggedToday: new Set(['leader-1']),
    });
    expect(due).toEqual([{ agentId: 'leader-1', kind: 'monday_digest', localDateIso: '2026-08-24' }]);
  });

  it('respects each agent independent time zone', () => {
    // Same UTC instant, one agent in a zone where it's not yet 7pm.
    const due = agentsDueNow({
      agents: [
        associate({ agentId: 'ny', timeZone: 'America/New_York' }),
        associate({ agentId: 'la', timeZone: 'America/Los_Angeles' }),
      ],
      now: MONDAY_EVENING,
      alreadySent: new Set(),
      loggedToday: new Set(),
    });
    expect(due.map((d) => d.agentId)).toEqual(['ny']);
  });

  it('returns nothing when no one is in any window', () => {
    const due = agentsDueNow({
      agents: [associate(), leader()],
      now: new Date('2026-08-24T15:00:00.000Z'), // mid-afternoon NY
      alreadySent: new Set(),
      loggedToday: new Set(),
    });
    expect(due).toEqual([]);
  });
});
