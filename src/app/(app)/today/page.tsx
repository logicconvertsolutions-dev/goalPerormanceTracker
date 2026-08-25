import { requireVerifiedAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { todayIso } from '@/lib/dates';
import { TodayRow } from './today-row';

export default async function TodayPage() {
  const session = await requireVerifiedAgent();
  const supabase = await createClient();

  const { data: followUps } = await supabase.rpc('my_followups');
  const rows = followUps ?? [];

  const { count: callsToday } = await supabase
    .from('call_logs')
    .select('id', { count: 'exact', head: true })
    .eq('agent_id', session.agent!.id)
    .eq('call_date', todayIso());

  const overdue = rows.filter((r) => r.days_late > 0);
  const dueToday = rows.filter((r) => r.days_late === 0);

  return (
    <div className="space-y-4 max-w-lg">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-heading-tight text-fg">My Day</h1>
        <p className="text-sm text-fg-3">{callsToday ?? 0} calls logged today</p>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="pt-4 space-y-3">
            <p className="text-sm text-fg-2">
              Nothing due today. Set a follow-up when you log a call and it&apos;ll show
              up here.
            </p>
            <Button asChild variant="primary">
              <Link href="/log">Log a new call</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <p className="text-sm text-fg-3">
            {overdue.length} overdue · {dueToday.length} due today
          </p>

          {overdue.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm text-bad">Overdue</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {overdue.map((row) => (
                  <TodayRow
                    key={row.call_id}
                    callLogId={row.call_id}
                    contactId={row.contact_id}
                    contactName={row.contact_name}
                    lastNote={row.last_note}
                    timesCalled={row.times_called}
                    daysLate={row.days_late}
                    overdue
                  />
                ))}
              </CardContent>
            </Card>
          )}

          {dueToday.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Due today</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {dueToday.map((row) => (
                  <TodayRow
                    key={row.call_id}
                    callLogId={row.call_id}
                    contactId={row.contact_id}
                    contactName={row.contact_name}
                    lastNote={row.last_note}
                    timesCalled={row.times_called}
                    daysLate={row.days_late}
                  />
                ))}
              </CardContent>
            </Card>
          )}

          <div className="text-center pt-2">
            <Button asChild variant="ghost">
              <Link href="/log">Nothing else due. Log a new call →</Link>
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
