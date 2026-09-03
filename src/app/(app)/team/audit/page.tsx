import { requireLeader } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { AuditLogTable, type AuditLogRow } from '@/components/shell/audit-log-table';
import { BackLink } from '@/components/shell/back-link';

export default async function TeamAuditPage() {
  const session = await requireLeader();
  const supabase = await createClient();

  // audit_leader_read (p6a) scopes this to the caller's own org already —
  // no additional filter needed here.
  const { data: entries } = await supabase
    .from('audit_log')
    .select('id, actor_id, action, entity, entity_id, metadata, created_at')
    .order('created_at', { ascending: false })
    .limit(200);

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
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-[28px] font-bold leading-[34px] tracking-heading-tight text-fg">Audit</h1>
        <BackLink href="/team" label="Team" />
      </div>
      <p className="text-sm text-fg-3">
        Goal changes, invitations, and deactivations for your team. Who, what, when.
      </p>
      <AuditLogTable rows={rows} title="Recent activity" viewerTimeZone={session.agent!.time_zone} />
    </div>
  );
}
