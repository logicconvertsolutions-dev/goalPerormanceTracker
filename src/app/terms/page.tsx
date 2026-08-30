import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BackLink } from '@/components/shell/back-link';

// Public, no-login page -- linked from the accept-invite screen (before an
// account exists), the one-time /terms/accept gate, and /settings. Keep this
// and /privacy in sync: they're accepted together as one checkbox at signup.
export default function TermsPage() {
  return (
    <main className="min-h-screen px-4 py-12 bg-bg">
      <div className="mx-auto w-full max-w-2xl space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold tracking-heading-tight text-fg">Terms &amp; Conditions</h1>
          <BackLink href="/settings" label="Settings" />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Using the app</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-fg-2">
            <p>
              This app is provided to you by your organization to track your own sales and
              recruiting activity. Access is by invitation only — you agree to keep your login
              credentials confidential and not to share your account with anyone else.
            </p>
            <p>
              You&apos;re responsible for the accuracy of what you log. Don&apos;t use the app to
              store anything unrelated to your work activity, and don&apos;t attempt to access
              another agent&apos;s contacts, notes, or account.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Your data</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-fg-2">
            <p>
              How your information is collected, used, and retained is described in the{' '}
              <Link href="/privacy" className="text-acc hover:underline">
                privacy notice
              </Link>
              , which is part of these terms. In short: your SMD sees your numbers, never your
              contacts or notes.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Availability and liability</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-fg-2">
            <p>
              The app is provided &quot;as is,&quot; without warranty of any kind. We aim for high
              availability but don&apos;t guarantee the service will be uninterrupted or
              error-free, and we&apos;re not liable for lost data or business decisions made from
              it. Log important commitments elsewhere too if they&apos;re time-sensitive.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Account status and changes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-fg-2">
            <p>
              Your SMD or an administrator can deactivate your access at any time, for example
              when you leave the organization. We may update these terms as the product changes;
              continuing to use the app after an update means you accept the revised terms.
            </p>
            <p>These terms are governed by the laws of the Province of Ontario, Canada.</p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
