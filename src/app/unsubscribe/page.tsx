import Link from 'next/link';
import { verifyUnsubscribe } from '@/lib/notifications/unsubscribe-token';
import { createAdminClient } from '@/lib/supabase/admin';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const LABELS: Record<string, string> = {
  evening_nudge: 'Evening nudge',
  sunday_summary: 'Sunday summary',
  monday_digest: 'Monday team digest',
};

// Public, no-login page -- the whole point of a one-click unsubscribe
// (09-account-and-auth.md) is that it works from the email client without
// signing in first. Authorization is the HMAC signature in the link, not a
// session; see src/lib/notifications/unsubscribe-token.ts.
export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { agent, kind, sig } = await searchParams;
  const valid = !!agent && !!kind && !!sig && verifyUnsubscribe(agent, kind, sig);

  if (valid) {
    const admin = createAdminClient();
    const column = kind as 'evening_nudge' | 'sunday_summary' | 'monday_digest';
    const patch =
      column === 'evening_nudge'
        ? { evening_nudge: false }
        : column === 'sunday_summary'
          ? { sunday_summary: false }
          : { monday_digest: false };
    await admin.from('notification_prefs').upsert({ agent_id: agent, ...patch }, { onConflict: 'agent_id' });
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-12 bg-bg">
      <div className="w-full max-w-sm">
        <Card>
          <CardHeader>
            <CardTitle>{valid ? "You're unsubscribed" : 'Link not valid'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-fg-2">
            {valid ? (
              <p>
                You won&apos;t get the <strong>{LABELS[kind!] ?? 'selected'}</strong> email anymore.
              </p>
            ) : (
              <p>This unsubscribe link is invalid or has already been used.</p>
            )}
            <p>
              <Link href="/settings" className="underline">
                Manage all notification preferences
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
