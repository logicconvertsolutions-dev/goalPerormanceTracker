// @vitest-environment jsdom
//
// Golden-file test (docs/05-testing.md): import the real
// ".github/Spec Sheets/weekly_calls_tracker - Template.xlsx", drain the
// queue, and assert the resulting daily_metrics rows plus the derived
// values from src/lib/metrics.ts equal the workbook's own Dashboard-tab
// formulas. Never delete this file — the second `it` below is P4's thinner
// assertion that the rendered dashboard shows the same numbers.
//
// Requires local Supabase running (`supabase start`). Environment is jsdom
// (not the usual `node` override) because the P4 half renders React
// components with @testing-library/react.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'jest-axe';
import fs from 'node:fs';
import path from 'node:path';
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import type { Database } from '../../../../types/database';
import { parseWorkbook } from '../parse-workbook';
import { commitImport } from '../commit-import';
import {
  conversionFunnel,
  dialToConnectRatio,
  noShowRate,
  rollingAvgCallsPerWeek,
  type DailyMetricsRow,
} from '@/lib/metrics';
import { buildDashboardViewModel } from '@/app/(app)/dashboard/dashboard-view-model';
import { DashboardView } from '@/app/(app)/dashboard/dashboard-view';
import { weekStart } from '@/lib/dates';

const WORKBOOK_PATH = path.resolve(
  __dirname,
  '../../../../.github/Spec Sheets/weekly_calls_tracker - Template.xlsx'
);

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const canRun = Boolean(SUPABASE_URL && SERVICE_ROLE_KEY);

function admin(): SupabaseClient<Database> {
  return createSupabaseClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
    // Realtime's client construction requires a WebSocket global (native on
    // Node 22+); this test never subscribes to anything, but the client
    // still constructs one, so supply the `ws` package already present
    // transitively via jsdom rather than requiring Node 22.
    realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
  });
}

// agent_aggregate/my_target filter on auth.uid() (private.is_upline_of, etc.),
// which the service-role admin client has no JWT for — it silently returns
// zero rows rather than erroring. The P4 rendering assertion below needs a
// client authenticated as the test agent, same as the real /dashboard page.
function anon(): SupabaseClient<Database> {
  return createSupabaseClient<Database>(SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
  });
}

describe.skipIf(!canRun)('golden-file: weekly_calls_tracker Template.xlsx', () => {
  const supabase = canRun ? admin() : (null as unknown as SupabaseClient<Database>);
  const testEmail = `golden-file-${Date.now()}@example.com`;
  let orgId: string;
  let agentId: string;

  beforeAll(async () => {
    const { data: provisioned, error: provisionError } = await supabase.rpc('provision_org', {
      p_org_name: 'Golden File Test Org',
      p_smd_email: testEmail,
      p_smd_name: 'Golden File Tester',
    });
    if (provisionError || !provisioned?.[0]) {
      throw new Error(`provision_org failed: ${provisionError?.message}`);
    }
    orgId = provisioned[0].org_id;

    const { data: userData, error: createUserError } = await supabase.auth.admin.createUser({
      email: testEmail,
      password: 'golden-file-test-password',
      email_confirm: true,
      user_metadata: { full_name: 'Golden File Tester' },
    });
    if (createUserError || !userData?.user) {
      throw new Error(`createUser failed: ${createUserError?.message}`);
    }
    agentId = userData.user.id;
  });

  afterAll(async () => {
    if (agentId) await supabase.auth.admin.deleteUser(agentId);
    if (orgId) await supabase.from('organizations').delete().eq('id', orgId);
  });

  it('imported daily_metrics + lib/metrics.ts match the workbook Dashboard tab', async () => {
    const buffer = fs.readFileSync(WORKBOOK_PATH);
    const parsed = parseWorkbook(buffer);

    const importable = parsed.rows.filter((r) => r.errors.length === 0);
    expect(importable).toHaveLength(5); // 2 calls + 1 appt + 1 sale + 1 recruiting

    const commitResult = await commitImport(supabase, agentId, orgId, parsed.rows);
    expect(commitResult.errors).toEqual([]);
    expect(commitResult.imported).toBe(5);

    const { error: drainError } = await supabase.rpc('drain_metrics', { p_limit: 500 });
    expect(drainError).toBeNull();

    const { data: rows, error: readError } = await supabase
      .from('daily_metrics')
      .select('*')
      .eq('agent_id', agentId)
      .order('activity_date');
    expect(readError).toBeNull();

    const weekRows = (rows ?? []) as DailyMetricsRow[];

    // Workbook: Call Log has 2 rows in the week of 2026-07-06 (07-06 and the
    // 46215 serial = 07-12), 1 held appointment ($85, 1 referral) on 07-08,
    // 1 sale ($85) on 07-09, 1 recruiting conversation on 07-07.
    const totals = weekRows.reduce(
      (acc, r) => ({
        callsMade: acc.callsMade + r.calls_made,
        outAppointmentSet: acc.outAppointmentSet + r.out_appt_set,
        outNoAnswer: acc.outNoAnswer + r.out_no_answer,
        srcWarmMarket: acc.srcWarmMarket + r.src_warm_market,
        srcFriend: acc.srcFriend + r.src_friend,
        apptHeld: acc.apptHeld + r.appt_held,
        referralsGiven: acc.referralsGiven + r.referrals_given,
        salesCount: acc.salesCount + r.sales_count,
        premiumCents: acc.premiumCents + r.premium_cents,
        recruitingConvos: acc.recruitingConvos + r.recruiting_convos,
      }),
      {
        callsMade: 0,
        outAppointmentSet: 0,
        outNoAnswer: 0,
        srcWarmMarket: 0,
        srcFriend: 0,
        apptHeld: 0,
        referralsGiven: 0,
        salesCount: 0,
        premiumCents: 0,
        recruitingConvos: 0,
      }
    );

    // Dashboard "This Week: Target vs Actual" — Calls Made actual = 1 in the
    // stale template snapshot (it only had the 07-06 row at export time); the
    // freshly-imported data has both call rows, so actual = 2. The workbook's
    // own COUNTIFS formula (not its cached value) is what's being mirrored
    // here, since a live re-open of the sheet after this import would also
    // show 2 — the cached "1" merely predates the second row.
    expect(totals.callsMade).toBe(2);
    expect(totals.outAppointmentSet).toBe(1); // "Appointment Set" outcome, 07-06 row
    expect(totals.outNoAnswer).toBe(1); // "No Answer" outcome, 07-12 row
    expect(totals.srcWarmMarket).toBe(1);
    expect(totals.srcFriend).toBe(1);
    expect(totals.apptHeld).toBe(1);
    expect(totals.referralsGiven).toBe(1);
    expect(totals.salesCount).toBe(1);
    expect(totals.premiumCents).toBe(8500);
    expect(totals.recruitingConvos).toBe(1);

    // Dashboard B70: dial-to-connect = connected / calls made. Neither
    // imported call has outcome "Connected", so this is 0.
    expect(dialToConnectRatio(weekRows)).toBe(0);

    // Dashboard B71: no-show rate = no-shows / all appointment statuses this
    // week. Only a "Held" appointment was imported, no no-shows.
    expect(noShowRate(weekRows)).toBe(0);

    // Dashboard B82-B85 funnel: each stage as a % of calls made (2).
    const funnel = conversionFunnel(weekRows);
    expect(funnel.callsMade).toBe(2);
    expect(funnel.apptsHeld).toBe(1);
    expect(funnel.salesClosed).toBe(1);
    expect(funnel.pctApptsHeld).toBe(0.5);
    expect(funnel.pctSalesClosed).toBe(0.5);

    // Dashboard B77: 4-week rolling average always divides by 4.
    expect(rollingAvgCallsPerWeek([weekRows])).toBe(0.5); // 2 calls / 4

    // Idempotency: re-parsing and re-committing the same file imports 0 new
    // rows and does not change daily_metrics.
    const secondParse = parseWorkbook(buffer);
    const secondCommit = await commitImport(supabase, agentId, orgId, secondParse.rows);
    expect(secondCommit.imported).toBe(0);
    expect(secondCommit.skippedDuplicate).toBe(5);

    await supabase.rpc('drain_metrics', { p_limit: 500 });
    const { data: rowsAfterReimport } = await supabase
      .from('daily_metrics')
      .select('calls_made')
      .eq('agent_id', agentId);
    const callsAfterReimport = (rowsAfterReimport ?? []).reduce((acc, r) => acc + r.calls_made, 0);
    expect(callsAfterReimport).toBe(2);
  });

  // Sign in as the test agent and fetch exactly what /dashboard fetches
  // (agent_aggregate, my_target) against the same imported, drained data.
  // Shared by both P4 assertions below so neither can drift from the other.
  async function fetchDashboardViewModel() {
    const weekOf = '2026-07-06';
    const from = weekStart(new Date(weekOf + 'T00:00:00Z'));
    const to = from;

    // agent_aggregate/my_target resolve auth.uid() from the calling session's
    // JWT, which the admin client above has none of.
    const asAgent = anon();
    const { error: signInError } = await asAgent.auth.signInWithPassword({
      email: testEmail,
      password: 'golden-file-test-password',
    });
    expect(signInError).toBeNull();

    const { data: agg, error: aggError } = await asAgent.rpc('agent_aggregate', {
      p_agent_id: agentId,
      p_from: from,
      p_to: '2026-07-12', // covers both imported call rows (07-06 and 07-12)
    });
    expect(aggError).toBeNull();

    const { data: target, error: targetError } = await asAgent.rpc('my_target', { p_week: to });
    expect(targetError).toBeNull();
    await asAgent.auth.signOut();

    return buildDashboardViewModel({
      totals: agg?.[0],
      target: target?.[0],
      trendRows: [],
      openAppointments: [],
      streakRows: new Map(),
      today: '2026-07-12',
    });
  }

  // P4: the rendered dashboard must display the same numbers the data-layer
  // test above already proved correct — not a fresh fixture that could drift
  // from that assertion.
  it('rendered dashboard shows the same numbers as daily_metrics', async () => {
    const vm = await fetchDashboardViewModel();

    // Same totals asserted against daily_metrics directly, above.
    expect(vm.callsMade).toBe(2);
    expect(vm.apptsHeld).toBe(1);
    expect(vm.premiumCents).toBe(8500);
    expect(vm.referralsGiven).toBe(1);
    expect(vm.funnel.callsMade).toBe(2);
    expect(vm.funnel.pctApptsHeld).toBe(0.5);
    expect(vm.funnel.pctSalesClosed).toBe(0.5);

    render(<DashboardView vm={vm} />);

    // Scope each assertion to its KPI card (label text is unique) rather than
    // querying the bare value, which can collide with donut-legend or table
    // fallback numbers rendered elsewhere on the page.
    expect(screen.getByText('Calls Made').closest('div')?.parentElement).toHaveTextContent('2');
    expect(screen.getByText('Premium').closest('div')?.parentElement).toHaveTextContent('$85');
    expect(screen.getByText('Appointments Held').closest('div')?.parentElement).toHaveTextContent('1');
  });

  // P4 DoD: axe-core clean on /dashboard (05-testing.md). Runs against the
  // same populated view model as the assertion above, since an empty-state
  // render would trivially pass and prove nothing about the real charts/KPI
  // grid a signed-in agent actually sees.
  it('has no axe violations', async () => {
    const vm = await fetchDashboardViewModel();
    const { container } = render(<DashboardView vm={vm} />);

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
