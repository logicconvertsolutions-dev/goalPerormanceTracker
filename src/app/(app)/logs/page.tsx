import Link from 'next/link';
import { requireVerifiedAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/shell/page-header';
import { LogActivityButton } from '@/components/shell/log-activity-button';
import { FilterBar, type FilterChip } from '@/components/shell/filter-bar';
import { ACTIVITY_META, type ActivityKind } from '@/components/shell/activity-icons';
import { resolvePeriod, todayIso, type PeriodPreset, PERIOD_PRESETS } from '@/lib/dates';
import { CallRow } from '../log/call-row';
import { AppointmentRow } from '../appointments/appointment-row';
import { SaleRow } from '../sales/sale-row';
import { RecruitingRow } from '../recruiting/recruiting-row';
import { CallsSourceFilter } from './calls-source-filter';

function isPeriodPreset(v: string | undefined): v is PeriodPreset {
  return !!v && (PERIOD_PRESETS as readonly string[]).includes(v);
}

const TABS: ActivityKind[] = ['call', 'appointment', 'sale', 'recruiting'];

const CALL_SOURCES = ['warm_market', 'referral', 'cold', 'social_media', 'friend', 'other'] as const;
const CALL_SOURCE_LABELS: Record<(typeof CALL_SOURCES)[number], string> = {
  warm_market: 'Warm market',
  referral: 'Referral',
  cold: 'Cold',
  social_media: 'Social media',
  friend: 'Friend',
  other: 'Other',
};

/**
 * One entry point for "everything I've logged", switchable by activity type.
 * Replaces the plain-text Appointments/Sales/Recruiting quick-links that
 * used to sit at the top of /dashboard. Each tab shows a trimmed table for
 * the selected period; the dedicated /appointments, /sales, /recruiting
 * pages remain the place for full filtering, sorting, and CSV export.
 */
export default async function LogsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const session = await requireVerifiedAgent();
  const agentId = session.agent!.id;
  const supabase = await createClient();

  const today = todayIso(session.agent!.time_zone);
  const preset: PeriodPreset = isPeriodPreset(params.period) ? params.period : 'this_week';
  const { from, to } = resolvePeriod(preset, today, params.from, params.to);
  const type: ActivityKind = (['call', 'appointment', 'sale', 'recruiting'] as const).includes(
    params.type as ActivityKind
  )
    ? (params.type as ActivityKind)
    : 'call';
  const sourceFilter: (typeof CALL_SOURCES)[number] | '' =
    type === 'call' && params.source && (CALL_SOURCES as readonly string[]).includes(params.source)
      ? (params.source as (typeof CALL_SOURCES)[number])
      : '';

  const [{ count: callCount }, { count: apptCount }, { count: saleCount }, { count: recruitCount }] =
    await Promise.all([
      supabase
        .from('call_logs')
        .select('id', { count: 'exact', head: true })
        .eq('agent_id', agentId)
        .gte('call_date', from)
        .lte('call_date', to),
      supabase
        .from('appointments')
        .select('id', { count: 'exact', head: true })
        .eq('agent_id', agentId)
        .gte('appt_date', from)
        .lte('appt_date', to),
      supabase
        .from('sales')
        .select('id', { count: 'exact', head: true })
        .eq('agent_id', agentId)
        .gte('sale_date', from)
        .lte('sale_date', to),
      supabase
        .from('recruiting_logs')
        .select('id', { count: 'exact', head: true })
        .eq('agent_id', agentId)
        .gte('log_date', from)
        .lte('log_date', to),
    ]);

  const counts: Record<ActivityKind, number> = {
    call: callCount ?? 0,
    appointment: apptCount ?? 0,
    sale: saleCount ?? 0,
    recruiting: recruitCount ?? 0,
  };

  function tabHref(kind: ActivityKind) {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || k === 'type') continue;
      if (k === 'source' && kind !== 'call') continue; // source only applies to the Calls tab
      next.set(k, v);
    }
    next.set('type', kind);
    return `/logs?${next.toString()}`;
  }

  const chips: FilterChip[] = [];
  if (sourceFilter) chips.push({ key: 'source', label: CALL_SOURCE_LABELS[sourceFilter] });

  return (
    <div className="space-y-4 max-w-3xl">
      <PageHeader
        title="Activity Logs"
        action={
          <LogActivityButton variant="primary" size="sm">
            Log activity
          </LogActivityButton>
        }
      />

      <div className="flex flex-wrap gap-1 rounded-sm border border-line bg-panel-2 p-1">
        {TABS.map((kind) => {
          const meta = ACTIVITY_META[kind];
          const Icon = meta.icon;
          const active = type === kind;
          return (
            <Link
              key={kind}
              href={tabHref(kind)}
              className={
                active
                  ? 'inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-sm font-medium shadow-lift'
                  : 'inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-sm font-medium text-fg-2 hover:text-fg transition-smooth'
              }
              style={active ? { backgroundColor: `${meta.color}1A`, color: meta.color } : undefined}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {meta.label}s
              <Badge
                variant={active ? 'default' : 'neutral'}
                className="ml-0.5 px-1.5 py-0 text-[10px]"
                style={active ? { backgroundColor: meta.color, color: '#fff' } : undefined}
              >
                {counts[kind]}
              </Badge>
            </Link>
          );
        })}
      </div>

      <FilterBar preset={preset} customFrom={params.from} customTo={params.to} chips={chips}>
        {type === 'call' && <CallsSourceFilter value={sourceFilter} />}
      </FilterBar>

      {type === 'call' && <CallsTab agentId={agentId} from={from} to={to} source={sourceFilter} />}
      {type === 'appointment' && <AppointmentsTab agentId={agentId} from={from} to={to} />}
      {type === 'sale' && <SalesTab agentId={agentId} from={from} to={to} />}
      {type === 'recruiting' && <RecruitingTab agentId={agentId} from={from} to={to} />}
    </div>
  );

  async function CallsTab({
    agentId,
    from,
    to,
    source,
  }: {
    agentId: string;
    from: string;
    to: string;
    source: (typeof CALL_SOURCES)[number] | '';
  }) {
    let query = supabase
      .from('call_logs')
      .select('id, call_date, source, outcome, notes, contacts(full_name)')
      .eq('agent_id', agentId)
      .gte('call_date', from)
      .lte('call_date', to);

    if (source) query = query.eq('source', source);

    const { data } = await query.order('call_date', { ascending: false }).limit(50);
    const rows = data ?? [];

    if (rows.length === 0) return <EmptyState label="calls" />;

    return (
      <ListTable headers={['Date', 'Contact', 'Source', 'Outcome', 'Notes']}>
        {rows.map((c) => (
          <CallRow
            key={c.id}
            id={c.id}
            callDate={c.call_date}
            source={c.source}
            outcome={c.outcome}
            notes={c.notes}
            contactName={(c.contacts as { full_name: string } | null)?.full_name ?? '—'}
          />
        ))}
      </ListTable>
    );
  }

  async function AppointmentsTab({ agentId, from, to }: { agentId: string; from: string; to: string }) {
    const { data } = await supabase
      .from('appointments')
      .select('id, appt_date, appt_type, status, expected_premium_cents, referrals_given, contacts(full_name)')
      .eq('agent_id', agentId)
      .gte('appt_date', from)
      .lte('appt_date', to)
      .order('appt_date', { ascending: false })
      .limit(50);
    const rows = data ?? [];

    if (rows.length === 0) return <EmptyState label="appointments" />;

    return (
      <>
        <ListTable
          headers={['Date', 'Contact', 'Type', 'Status', 'Expected premium', 'Referrals']}
        >
          {rows.map((a) => (
            <AppointmentRow
              key={a.id}
              id={a.id}
              apptDate={a.appt_date}
              apptType={a.appt_type}
              status={a.status}
              expectedPremiumCents={a.expected_premium_cents}
              referralsGiven={a.referrals_given}
              contactName={(a.contacts as { full_name: string } | null)?.full_name ?? '—'}
            />
          ))}
        </ListTable>
        <ViewAllLink href="/appointments" />
      </>
    );
  }

  async function SalesTab({ agentId, from, to }: { agentId: string; from: string; to: string }) {
    const { data } = await supabase
      .from('sales')
      .select('id, sale_date, product_type, premium_cents, contacts(full_name)')
      .eq('agent_id', agentId)
      .gte('sale_date', from)
      .lte('sale_date', to)
      .order('sale_date', { ascending: false })
      .limit(50);
    const rows = data ?? [];

    if (rows.length === 0) return <EmptyState label="sales" />;

    return (
      <>
        <ListTable headers={['Date', 'Client', 'Product type', 'Premium']}>
          {rows.map((s) => (
            <SaleRow
              key={s.id}
              id={s.id}
              saleDate={s.sale_date}
              clientName={(s.contacts as { full_name: string } | null)?.full_name ?? '—'}
              productType={s.product_type}
              premiumCents={s.premium_cents}
            />
          ))}
        </ListTable>
        <ViewAllLink href="/sales" />
      </>
    );
  }

  async function RecruitingTab({ agentId, from, to }: { agentId: string; from: string; to: string }) {
    const { data } = await supabase
      .from('recruiting_logs')
      .select('id, log_date, source, status, contacts(full_name)')
      .eq('agent_id', agentId)
      .gte('log_date', from)
      .lte('log_date', to)
      .order('log_date', { ascending: false })
      .limit(50);
    const rows = data ?? [];

    if (rows.length === 0) return <EmptyState label="recruiting conversations" />;

    return (
      <>
        <ListTable headers={['Date', 'Prospect', 'Source', 'Status']}>
          {rows.map((r) => (
            <RecruitingRow
              key={r.id}
              id={r.id}
              logDate={r.log_date}
              prospectName={(r.contacts as { full_name: string } | null)?.full_name ?? '—'}
              source={r.source}
              status={r.status}
            />
          ))}
        </ListTable>
        <ViewAllLink href="/recruiting" />
      </>
    );
  }
}

function ListTable({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line shadow-card">
      <table className="w-full text-sm">
        <thead className="bg-bg-2 text-fg-3 text-xs uppercase tracking-wide">
          <tr>
            {headers.map((h) => (
              <th key={h} className="text-left font-medium px-4 py-2.5">
                {h}
              </th>
            ))}
            <th className="px-4 py-2.5" />
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function ViewAllLink({ href }: { href: string }) {
  return (
    <p className="text-xs text-fg-3">
      Need filters, sorting, or CSV export?{' '}
      <Link href={href} className="text-acc hover:underline">
        Open the full {href.slice(1)} page →
      </Link>
    </p>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <p className="text-sm text-fg-2">No {label} logged in this period.</p>
      </CardContent>
    </Card>
  );
}
