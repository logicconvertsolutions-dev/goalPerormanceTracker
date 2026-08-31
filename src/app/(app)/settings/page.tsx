import Link from 'next/link';
import { requireVerifiedAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { weekStart } from '@/lib/dates';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/shell/page-header';
import { NotificationToggles } from './notification-toggles';
import { TimeZoneSelect } from './time-zone-select';
import { DataActions } from './data-actions';

export default async function SettingsPage() {
  const session = await requireVerifiedAgent();
  const supabase = await createClient();
  // Admins aren't part of any organization and don't log activity of their
  // own (see docs/09-account-and-auth.md) -- they have no target to resolve
  // and never receive the evening-nudge/summary/digest emails these two
  // cards are about, so skip both the fetches and the sections entirely.
  const isAdmin = session.agent!.role === 'admin';

  const [{ data: target }, { data: prefs }] = isAdmin
    ? [{ data: null }, { data: null }]
    : await Promise.all([
        supabase.rpc('my_target', { p_week: weekStart(new Date()) }),
        supabase
          .from('notification_prefs')
          .select('*')
          .eq('agent_id', session.userId)
          .maybeSingle(),
      ]);

  const t = target?.[0] ?? null;

  return (
    <div className="space-y-4 max-w-lg">
      <PageHeader title="Settings" />

      {!isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Your goals</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-fg-3 mb-3">Set by your SMD</p>
            {t ? (
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-fg-3">Calls / week</dt>
                  <dd className="font-mono tabular-nums text-fg">{t.calls_per_week}</dd>
                </div>
                <div>
                  <dt className="text-fg-3">Appts held / week</dt>
                  <dd className="font-mono tabular-nums text-fg">
                    {t.appts_held_per_week}
                  </dd>
                </div>
                <div>
                  <dt className="text-fg-3">Premium / week</dt>
                  <dd className="font-mono tabular-nums text-fg">
                    ${(t.premium_cents_per_week / 100).toFixed(0)}
                  </dd>
                </div>
                <div>
                  <dt className="text-fg-3">Min calls / day</dt>
                  <dd className="font-mono tabular-nums text-fg">
                    {t.min_calls_per_day}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-fg-3">No goal set yet.</p>
            )}
          </CardContent>
        </Card>
      )}

      {!isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Notifications</CardTitle>
          </CardHeader>
          <CardContent>
            <NotificationToggles
              initial={{
                eveningNudge: prefs?.evening_nudge ?? true,
                sundaySummary: prefs?.sunday_summary ?? true,
                mondayDigest: prefs?.monday_digest ?? true,
              }}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Time zone &amp; week</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <TimeZoneSelect current={session.agent!.time_zone} />
          <div>
            <p className="text-xs text-fg-3">Week start</p>
            <p className="text-sm text-fg">Monday</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Import from spreadsheet</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-fg-2">
            Bring in calls, appointments, sales, and recruiting conversations from your
            existing tracker workbook.
          </p>
          <Button asChild variant="secondary">
            <Link href="/import">Import a workbook</Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your data</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <DataActions />
          <div className="flex gap-3">
            <Link href="/privacy" className="text-xs text-acc hover:underline">
              Read the privacy notice
            </Link>
            <Link href="/terms" className="text-xs text-acc hover:underline">
              Read the Terms &amp; Conditions
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
