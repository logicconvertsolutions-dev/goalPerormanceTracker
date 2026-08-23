'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createClient } from '@/lib/supabase/client';

export function MfaVerifyFlow({ next }: { next: string }) {
  const router = useRouter();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data } = await supabase.auth.mfa.listFactors();
      const verified = data?.totp?.find((f) => f.status === 'verified');
      setFactorId(verified?.id ?? null);
      setLoading(false);
    })();
  }, []);

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setPending(true);
    setError(null);

    const supabase = createClient();
    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
      factorId,
    });
    if (challengeError || !challenge) {
      setPending(false);
      setError('Could not start verification. Try again.');
      return;
    }

    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code,
    });

    if (verifyError) {
      setPending(false);
      setError('Incorrect code. Check your authenticator app and try again.');
      return;
    }

    router.push(next);
    router.refresh();
  }

  if (loading) return null;

  if (!factorId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No authenticator found</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-fg-2">
            You don&apos;t have a verified authenticator on file. Set one up to continue.
          </p>
          <Button variant="primary" onClick={() => router.push('/mfa/setup')}>
            Set up two-factor authentication
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Enter your code</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={handleVerify} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="code">Verification code</Label>
            <Input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-bad">{error}</p>}
          <Button type="submit" variant="primary" disabled={pending} className="w-full">
            {pending ? 'Verifying…' : 'Verify'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
