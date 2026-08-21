import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export interface AuditLogRow {
  id: number;
  action: string;
  entity: string;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  actor_name: string | null;
}

// Shared by /team/audit (leader, own org — audit_leader_read) and
// /admin/audit (admin, every org — audit_admin_read), both p6a policies on
// the same table. Neither query ever selects a prospect-facing column —
// audit_log only ever carries action/entity/entity_id/metadata, none of
// which are contact_name/notes.
export function AuditLogTable({ rows, title }: { rows: AuditLogRow[]; title: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.length === 0 ? (
          <p className="text-sm text-fg-3">Nothing logged yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-fg-3">
                  <th className="py-1.5 pr-3 font-medium">When</th>
                  <th className="py-1.5 pr-3 font-medium">Who</th>
                  <th className="py-1.5 pr-3 font-medium">Action</th>
                  <th className="py-1.5 font-medium">Details</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-line last:border-0">
                    <td className="py-1.5 pr-3 whitespace-nowrap text-fg-3">
                      {new Date(row.created_at).toLocaleString('en-CA', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </td>
                    <td className="py-1.5 pr-3 text-fg">{row.actor_name ?? 'System'}</td>
                    <td className="py-1.5 pr-3 font-mono text-xs text-fg">{row.action}</td>
                    <td className="py-1.5 text-fg-3 text-xs">
                      {Object.keys(row.metadata ?? {}).length > 0 ? JSON.stringify(row.metadata) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
