import { requireAdmin } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PublishAnnouncementForm } from './publish-announcement-form';
import { AnnouncementRow } from './announcement-row';

export default async function AdminAnnouncementsPage() {
  await requireAdmin();
  const supabase = await createClient();

  // announcements_select (p11e) shows an admin every row, active or not.
  const { data: announcements } = await supabase
    .from('announcements')
    .select('id, message, active, created_at')
    .order('created_at', { ascending: false });

  return (
    <div className="space-y-4 max-w-2xl">
      <h1 className="text-xl font-semibold tracking-heading-tight text-fg">Announcements</h1>
      <p className="text-sm text-fg-3">
        Publish a message every signed-in user sees at the top of the app — an upcoming update, a
        new feature, planned downtime. Each person can dismiss it; retracting it here removes it
        for everyone who hasn&apos;t yet.
      </p>

      <Card>
        <CardHeader>
          <CardTitle>New announcement</CardTitle>
        </CardHeader>
        <CardContent>
          <PublishAnnouncementForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>History</CardTitle>
        </CardHeader>
        <CardContent>
          {!announcements || announcements.length === 0 ? (
            <p className="text-sm text-fg-3">No announcements yet.</p>
          ) : (
            announcements.map((a) => (
              <AnnouncementRow key={a.id} id={a.id} message={a.message} active={a.active} createdAt={a.created_at} />
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
