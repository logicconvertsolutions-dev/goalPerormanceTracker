import { requireAdmin } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { FeedbackRow } from './feedback-row';

export default async function AdminFeedbackPage() {
  await requireAdmin();
  const supabase = await createClient();

  // feedback_admin_read (p10b) has no org filter -- everything, every org,
  // same shape as /admin/audit.
  const { data: reports } = await supabase
    .from('feedback')
    .select('id, category, subject, message, page_url, status, created_at, agent_id, org_id')
    .order('created_at', { ascending: false })
    .limit(200);

  const agentIds = [...new Set((reports ?? []).map((r) => r.agent_id))];
  // A report from an admin (rare -- admins can submit feedback but aren't
  // part of any organization) carries a null org_id.
  const orgIds = [
    ...new Set((reports ?? []).map((r) => r.org_id).filter((id): id is string => id !== null)),
  ];
  const [{ data: agents }, { data: orgs }] = await Promise.all([
    agentIds.length > 0
      ? supabase.from('agents').select('id, full_name, email').in('id', agentIds)
      : Promise.resolve({ data: [] }),
    orgIds.length > 0
      ? supabase.from('organizations').select('id, name').in('id', orgIds)
      : Promise.resolve({ data: [] }),
  ]);
  const agentById = new Map((agents ?? []).map((a) => [a.id, a]));
  const orgNameById = new Map((orgs ?? []).map((o) => [o.id, o.name]));

  const rows = (reports ?? []).map((r) => ({
    id: r.id,
    category: r.category,
    subject: r.subject,
    message: r.message,
    page_url: r.page_url,
    status: r.status,
    created_at: r.created_at,
    reporterName: agentById.get(r.agent_id)?.full_name ?? 'Unknown',
    reporterEmail: agentById.get(r.agent_id)?.email ?? '',
    orgName: (r.org_id ? orgNameById.get(r.org_id) : null) ?? null,
  }));

  return (
    <div className="space-y-4 max-w-4xl">
      <h1 className="text-xl font-semibold tracking-heading-tight text-fg">Feedback</h1>
      <p className="text-sm text-fg-3">
        Bug reports, issues, and feedback submitted from the account menu. Every organization.
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-fg-3">Nothing submitted yet.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <FeedbackRow key={r.id} item={r} />
          ))}
        </div>
      )}
    </div>
  );
}
