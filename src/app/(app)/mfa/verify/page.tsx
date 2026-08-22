import { requireAgent } from '@/lib/auth/guards';
import { MfaVerifyFlow } from './mfa-verify-flow';

export default async function MfaVerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  await requireAgent();
  const { next } = await searchParams;

  return (
    <div className="max-w-md space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-heading-tight text-fg">
          Verify it&apos;s you
        </h1>
        <p className="text-sm text-fg-2 mt-1">
          Enter the code from your authenticator app to continue.
        </p>
      </div>
      <MfaVerifyFlow next={next && next.startsWith('/') ? next : '/team'} />
    </div>
  );
}
