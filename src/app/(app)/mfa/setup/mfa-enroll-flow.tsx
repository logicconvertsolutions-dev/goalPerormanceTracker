'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createClient } from '@/lib/supabase/client';
import { generateRecoveryCodes } from './actions';

type Step = 'qr' | 'verify' | 'codes';

export function MfaEnrollFlow() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('qr');
  const [factorId, setFactorId] = useState('');
  const [qrCode, setQrCode] = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [pending, setPending] = useState(false);

  async function startEnrollment() {
    setPending(true);
    setError(null);
    const supabase = createClient();
    const { data, error: enrollError } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
    });
    setPending(false);

    if (enrollError || !data) {
      setError('Could not start MFA setup. Try again.');
      return;
    }
    setFactorId(data.id);
    setQrCode(data.totp.qr_code);
    setSecret(data.totp.secret);
    setStep('verify');
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);

    const supabase = createClient();
    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
      factorId,
    });
    if (challengeError || !challenge) {
      setPending(false);
      setError('Could not verify. Try again.');
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

    const codes = await generateRecoveryCodes();
    setRecoveryCodes(codes);
    setPending(false);
    setStep('codes');
  }

  function downloadCodes() {
    const blob = new Blob([recoveryCodes.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  if (step === 'qr') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Scan with your authenticator app</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-fg-2">
            Use Google Authenticator, 1Password, or any TOTP app.
          </p>
          {error && <p className="text-sm text-bad">{error}</p>}
          <Button variant="primary" onClick={startEnrollment} disabled={pending}>
            {pending ? 'Starting…' : 'Begin setup'}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (step === 'verify') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Scan and verify</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrCode}
            alt="Scan this QR code with your authenticator app"
            className="mx-auto h-48 w-48 rounded-sm bg-white p-2"
          />
          <div className="space-y-1">
            <p className="text-xs text-fg-3">Can&apos;t scan? Enter this key manually:</p>
            <code className="block rounded-sm bg-sunken px-2 py-1.5 text-xs text-fg-2 break-all">
              {secret}
            </code>
          </div>
          <form onSubmit={handleVerify} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="code">Verification code</Label>
              <Input
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-bad">{error}</p>}
            <Button type="submit" variant="primary" disabled={pending} className="w-full">
              {pending ? 'Verifying…' : 'Verify and enable'}
            </Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Save your recovery codes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-fg-2">
          Each code works once if you lose access to your authenticator app.
          They&apos;re shown only this one time.
        </p>
        <div className="grid grid-cols-2 gap-2 rounded-sm border border-line-2 bg-sunken p-3 font-mono text-sm text-fg tabular-nums">
          {recoveryCodes.map((c) => (
            <span key={c}>{c}</span>
          ))}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={downloadCodes}>
            Download codes
          </Button>
          <Button variant="primary" onClick={() => router.push('/today')}>
            Done
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
