import { requireAdmin } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { AuditLogTable, type AuditLogRow } from '@/components/shell/audit-log-table';

export default async function AdminAuditPage() {
  await requireAdmin();
  const supabase = await createClient();

  // audit_admin_read (p1h) has no org filter -- everything, every org.
  const { data: entries } = await supabase
    .from('audit_log')
    .select('id, actor_id, action, entity, entity_id, metadata, created_at')
    .order('created_at', { ascending: false })
    .limit(500);

  const actorIds = [...new Set((entries ?? []).map((e) => e.actor_id).filter((id): id is string => !!id))];
  const { data: actors } =
    actorIds.length > 0
      ? await supabase.from('agents').select('id, full_name').in('id', actorIds)
      : { data: [] };
  const nameById = new Map((actors ?? []).map((a) => [a.id, a.full_name]));

  const rows: AuditLogRow[] = (entries ?? []).map((e) => ({
    ...e,
    metadata: (e.metadata as Record<string, unknown>) ?? {},
    actor_name: e.actor_id ? (nameById.get(e.actor_id) ?? null) : null,
  }));

  return (
    <div className="space-y-4 max-w-4xl">
      <h1 className="text-xl font-semibold tracking-heading-tight text-fg">Audit</h1>
      <p className="text-sm text-fg-3">Everything, every organization. Who, what, when.</p>
      <AuditLogTable rows={rows} title="Recent activity" />
    </div>
  );
}
