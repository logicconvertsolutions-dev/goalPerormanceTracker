import { requireAgent } from '@/lib/auth/guards';
import { MfaEnrollFlow } from './mfa-enroll-flow';

export default async function MfaSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ required?: string }>;
}) {
  const session = await requireAgent();
  const { required } = await searchParams;
  const isRequired = required === 'team' &&
    (session.agent!.role === 'leader' || session.agent!.role === 'admin');

  return (
    <div className="max-w-md space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-heading-tight text-fg">
          Set up two-factor authentication
        </h1>
        {isRequired && (
          <p className="text-sm text-warn mt-1">
            Required before you can access /team.
          </p>
        )}
      </div>
      <MfaEnrollFlow />
    </div>
  );
}
