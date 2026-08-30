import Link from 'next/link';
import { requireAgent } from '@/lib/auth/guards';
import { TermsAcceptForm } from './terms-accept-form';

// Deliberately calls requireAgent() directly, not requireVerifiedAgent() --
// that's what redirects here in the first place, and routing through it
// again would self-redirect-loop. Same reasoning as /mfa/setup and
// /mfa/verify (src/lib/auth/guards.ts).
export default async function TermsAcceptPage() {
  await requireAgent();

  return (
    <div className="max-w-md space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-heading-tight text-fg">
          Terms &amp; Conditions
        </h1>
        <p className="text-sm text-warn mt-1">Required before you can continue.</p>
      </div>
      <p className="text-sm text-fg-2">
        We now keep a record of agreement to our{' '}
        <Link href="/terms" target="_blank" className="text-acc hover:underline">
          Terms &amp; Conditions
        </Link>{' '}
        and{' '}
        <Link href="/privacy" target="_blank" className="text-acc hover:underline">
          Privacy Notice
        </Link>
        . Please confirm you agree to continue.
      </p>
      <TermsAcceptForm />
    </div>
  );
}
