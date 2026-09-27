import Link from 'next/link';
import { requireAgent } from '@/lib/auth/guards';
import { formatLongDate } from '@/lib/dates';
import { LEGAL_CHANGES, LEGAL_VERSION_DATE } from '@/lib/legal';
import { TermsAcceptForm } from './terms-accept-form';

// Deliberately calls requireAgent() directly, not requireVerifiedAgent() --
// that's what redirects here in the first place, and routing through it
// again would self-redirect-loop. Same reasoning as /mfa/setup and
// /mfa/verify (src/lib/auth/guards.ts).
//
// Two ways in: never accepted, or accepted a version older than
// LEGAL_VERSION_DATE (P33). The second is told what changed, so agreeing is
// informed consent to the change rather than a box ticked again.
export default async function TermsAcceptPage() {
  const session = await requireAgent();
  const updated = Boolean(session.agent!.terms_accepted_at);

  return (
    <div className="max-w-md space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-heading-tight text-fg">
          {updated ? 'We’ve updated our terms' : 'Terms & Conditions'}
        </h1>
        <p className="text-sm text-warn mt-1">Required before you can continue.</p>
      </div>
      {updated ? (
        <div className="space-y-2 text-sm text-fg-2">
          <p>
            Our{' '}
            <Link href="/terms" target="_blank" className="text-acc hover:underline">
              Terms &amp; Conditions
            </Link>{' '}
            and{' '}
            <Link href="/privacy" target="_blank" className="text-acc hover:underline">
              Privacy Notice
            </Link>{' '}
            changed on {formatLongDate(LEGAL_VERSION_DATE)}. What’s new:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            {LEGAL_CHANGES.map((change) => (
              <li key={change}>{change}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-fg-2">
          Please read our{' '}
          <Link href="/terms" target="_blank" className="text-acc hover:underline">
            Terms &amp; Conditions
          </Link>{' '}
          and{' '}
          <Link href="/privacy" target="_blank" className="text-acc hover:underline">
            Privacy Notice
          </Link>{' '}
          and confirm you agree to continue.
        </p>
      )}
      <TermsAcceptForm />
    </div>
  );
}
