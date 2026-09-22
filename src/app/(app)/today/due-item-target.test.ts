import { describe, expect, it } from 'vitest';
import { dueItemHref } from './due-item-target';

const ID = '11111111-1111-4111-8111-111111111111';

describe('dueItemHref — what tapping a My Day item opens', () => {
  it('opens a pending appointment itself, not the call dialog', () => {
    expect(dueItemHref('appointment', ID)).toBe(`/appointments/${ID}/edit`);
  });

  it('keeps every call-shaped item on the quick-log dialog', () => {
    expect(dueItemHref('follow_up', ID)).toBeNull();
    expect(dueItemHref('appointment_follow_up', ID)).toBeNull();
    // Legacy call-log appointment: its id is a call_logs id, so there is
    // no appointments row to route to.
    expect(dueItemHref('call_appointment', ID)).toBeNull();
  });
});
