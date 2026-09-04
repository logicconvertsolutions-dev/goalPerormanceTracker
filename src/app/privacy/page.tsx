import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BackLink } from '@/components/shell/back-link';

// Public, no-login page -- linked from the accept-invite screen (before an
// account exists) and from /settings. Content mirrors .github/Spec
// Sheets/04-security.md's Privacy (PIPEDA — Ontario) section; if that
// section changes, this page needs to change with it.
export default function PrivacyPage() {
  return (
    <main className="min-h-screen px-4 py-12 bg-bg">
      <div className="mx-auto w-full max-w-2xl space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold tracking-heading-tight text-fg">Privacy notice</h1>
          <BackLink href="/settings" label="Settings" />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>What your SMD can see</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-fg-2">
            <p>
              Your SMD (and anyone above them in your reporting line) sees your{' '}
              <strong>numbers</strong> — counts and totals like calls made, appointments held, and
              premium written, for you and your team, by day and by week.
            </p>
            <p>
              They never see your contacts&apos; names, your call notes, or any other free-text
              detail you write while logging. That data belongs to your own screens only.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>What we store and why</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-fg-2">
            <p>
              Purpose limitation: the contacts and notes you log exist to track your own activity.
              Nothing is sold, shared with a third party, or used to train any model.
            </p>
            <p>
              Data minimisation: a contact&apos;s full name is required today, so the app can tell
              two prospects apart and let you find them again. We do not collect or store a
              contact&apos;s phone number. We store what the product needs and nothing more.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>How long we keep it</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-fg-2">
            <p>
              Call logs older than 24 months are automatically deleted unless the contact went on
              to become a sale, in which case that history is kept as part of the client
              relationship. This runs on its own — you don&apos;t need to do anything.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Your data, your choice</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-fg-2">
            <p>
              From <Link href="/settings" className="text-acc hover:underline">Settings</Link>{' '}
              you can download everything you&apos;ve logged as JSON, at any time.
            </p>
            <p>
              You can also delete your account. That permanently removes your contacts and notes.
              Your SMD keeps the anonymised daily counts they already saw — never your contacts or
              notes — so your team&apos;s historical reporting doesn&apos;t change shape underneath
              them.
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
