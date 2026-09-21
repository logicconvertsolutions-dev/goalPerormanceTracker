import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import type { DueItemKind } from './use-follow-up-actions';

/** One row of `my_followups`, with `kind` narrowed from the generated
 *  `string` to the four literals the RPC can actually return. */
export interface DueItem {
  call_id: string;
  contact_id: string;
  contact_name: string;
  last_note: string | null;
  kind: DueItemKind;
  due_date: string | null;
  appointment_at: string | null;
  days_late: number;
  times_called: number;
}

/**
 * My Day's queue, fetched once per request.
 *
 * P25 D-1 gives the app shell a count badge, so `my_followups` is now
 * needed by the layout as well as by `/today` itself. Rather than add a
 * second count-only RPC that would restate the queue's four branches in a
 * different piece of SQL -- the exact drift that §6 and CLAUDE.md's
 * "a backfill must not be a second definition of the metric" warn about --
 * both callers read the same rows and the badge counts them in TypeScript.
 * One definition, in `my_followups`, forever.
 *
 * `cache()` is what makes that free: React memoizes for the lifetime of a
 * single server render, so the layout and the page rendering together
 * issue one round trip, not two. The memo is per-request and the client is
 * built from that request's own cookies, so no result is ever shared
 * across users.
 *
 * `asOf` is an explicit argument rather than read from the clock inside,
 * both so it participates in the memo key and because it must be the
 * agent's local calendar day -- `my_followups` would otherwise default to
 * the DB server's UTC `current_date`.
 */
export const fetchDueQueue = cache(async (asOf: string): Promise<DueItem[]> => {
  const supabase = await createClient();
  const { data } = await supabase.rpc('my_followups', { p_as_of: asOf });
  return (data ?? []).map((row) => ({ ...row, kind: row.kind as DueItemKind }));
});
