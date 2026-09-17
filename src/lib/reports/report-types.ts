// The Reports tab (P21) is a curated set of report types, not a generic
// object/join picker -- CLAUDE.md rule 2 forbids exposing raw activity
// tables to a cross-agent reader, so every reportable "object" here is
// either roster data (agents/organizations, already admin-readable via
// RLS) or a pre-aggregated SECURITY DEFINER RPC. This registry is the
// single source of truth for which columns exist per type, so the page and
// the CSV export can't drift from each other.

export type ReportTypeId = 'agent_roster' | 'org_summary' | 'activity_summary' | 'targets_vs_actuals';

export interface ReportColumn {
  key: string;
  label: string;
  format?: 'money' | 'percent' | 'boolean';
}

export interface ReportTypeConfig {
  id: ReportTypeId;
  label: string;
  description: string;
  needsDateRange: boolean;
  columns: ReportColumn[];
  defaultColumns: string[];
}

export const REPORT_TYPES: Record<ReportTypeId, ReportTypeConfig> = {
  agent_roster: {
    id: 'agent_roster',
    label: 'Agent Roster',
    description: 'Every active and inactive agent, across every organization.',
    needsDateRange: false,
    columns: [
      { key: 'full_name', label: 'Agent' },
      { key: 'email', label: 'Email' },
      { key: 'org_name', label: 'Organization' },
      { key: 'role', label: 'Role' },
      { key: 'upline_name', label: 'SMD' },
      { key: 'status', label: 'Status' },
      { key: 'joined_at', label: 'Joined' },
    ],
    defaultColumns: ['full_name', 'org_name', 'role', 'status', 'joined_at'],
  },
  org_summary: {
    id: 'org_summary',
    label: 'Organization Summary',
    description: 'Every organization with its agent counts.',
    needsDateRange: false,
    columns: [
      { key: 'name', label: 'Organization' },
      { key: 'agent_count', label: 'Agents' },
      { key: 'active_agent_count', label: 'Active Agents' },
      { key: 'leader_count', label: 'SMDs' },
      { key: 'created_at', label: 'Created' },
    ],
    defaultColumns: ['name', 'agent_count', 'active_agent_count', 'leader_count', 'created_at'],
  },
  activity_summary: {
    id: 'activity_summary',
    label: 'Activity Summary',
    description: 'Aggregated calls, appointments, and sales per agent over a period.',
    needsDateRange: true,
    columns: [
      { key: 'full_name', label: 'Agent' },
      { key: 'org_name', label: 'Organization' },
      { key: 'calls_made', label: 'Calls' },
      { key: 'appts_set', label: 'Appts Set' },
      { key: 'appts_held', label: 'Appts Held' },
      { key: 'sales_count', label: 'Sales' },
      { key: 'premium_cents', label: 'Premium', format: 'money' },
    ],
    defaultColumns: ['full_name', 'org_name', 'calls_made', 'appts_held', 'sales_count', 'premium_cents'],
  },
  targets_vs_actuals: {
    id: 'targets_vs_actuals',
    label: 'Targets vs Actuals',
    description: "Each agent's resolved goal for the period against what they actually logged.",
    needsDateRange: true,
    columns: [
      { key: 'full_name', label: 'Agent' },
      { key: 'org_name', label: 'Organization' },
      { key: 'calls_made', label: 'Calls' },
      { key: 'calls_target', label: 'Calls Target' },
      { key: 'pct_calls', label: 'Calls %', format: 'percent' },
      { key: 'appts_held', label: 'Appts Held' },
      { key: 'appts_held_target', label: 'Appts Held Target' },
      { key: 'premium_cents', label: 'Premium', format: 'money' },
      { key: 'premium_cents_target', label: 'Premium Target', format: 'money' },
      { key: 'min_calls_target', label: 'Min Calls/Day' },
      { key: 'streak_days', label: 'Streak (days)' },
      { key: 'has_override', label: 'Has Override', format: 'boolean' },
    ],
    defaultColumns: [
      'full_name',
      'org_name',
      'calls_made',
      'calls_target',
      'pct_calls',
      'premium_cents',
      'premium_cents_target',
    ],
  },
};

export const REPORT_TYPE_LIST = Object.values(REPORT_TYPES);

export function isReportTypeId(v: string | null | undefined): v is ReportTypeId {
  return !!v && v in REPORT_TYPES;
}

export function resolveColumns(type: ReportTypeId, requested: string[] | null): ReportColumn[] {
  const config = REPORT_TYPES[type];
  const keys = requested && requested.length > 0 ? requested : config.defaultColumns;
  const byKey = new Map(config.columns.map((c) => [c.key, c]));
  return keys.map((k) => byKey.get(k)).filter((c): c is ReportColumn => !!c);
}

export function formatCell(value: unknown, format?: ReportColumn['format']): string {
  if (value === null || value === undefined) return '—';
  if (format === 'money') return `$${(Number(value) / 100).toFixed(2)}`;
  if (format === 'percent') return `${value}%`;
  if (format === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}
