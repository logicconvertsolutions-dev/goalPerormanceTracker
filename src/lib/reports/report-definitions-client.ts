// public.report_definitions doesn't exist in types/database.ts yet (P21
// migration is staged for review, not applied -- see
// supabase/migrations/20260917100000_p21_admin_reports.sql). Scoped type
// assertion shared by the reports page and its Server Actions, same
// convention as fetch-report.ts's ReportRpcClient: becomes redundant (but
// harmless) once `npm run types` regenerates against a project with this
// migration applied.

export interface ReportDefinitionRow {
  id: string;
  created_by: string;
  report_type: string;
  name: string;
  filters: Record<string, string | undefined> | null;
  columns: string[] | null;
  created_at: string;
}

interface ReportDefinitionsSelect {
  order(
    column: string,
    opts?: { ascending?: boolean }
  ): Promise<{ data: ReportDefinitionRow[] | null; error: { message: string } | null }>;
}

interface ReportDefinitionsDelete {
  eq(column: 'id', value: string): Promise<{ error: { message: string } | null }>;
}

export interface ReportDefinitionsClient {
  from(table: 'report_definitions'): {
    select(columns: string): ReportDefinitionsSelect;
    insert(row: {
      created_by: string;
      report_type: string;
      name: string;
      filters: Record<string, string | undefined>;
      columns: string[];
    }): Promise<{ error: { message: string } | null }>;
    delete(): ReportDefinitionsDelete;
  };
}
