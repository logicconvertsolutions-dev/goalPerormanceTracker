'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { createClient } from '@/lib/supabase/client';
import { generateRecoveryCodes } from './actions';

type Step = 'qr' | 'verify' | 'codes';
type SupabaseClient = ReturnType<typeof createClient>;
type EnrollDraft = { factorId: string; qrCode: string; secret: string };

// sessionStorage, not localStorage: this is scoped to one in-progress setup
// attempt in this tab, not something that should outlive the session.
const DRAFT_KEY = 'kautis-mfa-enroll-draft';

function readDraft(): EnrollDraft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.factorId && parsed?.qrCode && parsed?.secret) return parsed;
  } catch {
    // Corrupt or inaccessible storage -- treat as no draft.
  }
  return null;
}

function writeDraft(draft: EnrollDraft) {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Storage unavailable (private browsing, quota) -- setup still works,
    // it just won't survive a reload.
  }
}

function clearDraft() {
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // Nothing to clean up if storage was never accessible.
  }
}

/**
 * Removes any unverified TOTP factor left behind by an attempt that never
 * finished (e.g. the user left the page to read the code in their
 * authenticator app, and a reload wiped this component's state -- common on
 * mobile, especially an installed/PWA session, which is far more likely to
 * be reloaded on backgrounding than a desktop tab). enroll() always creates
 * a factor with an empty friendly name, and Supabase rejects a second one
 * with the same name for the same user (422 mfa_factor_name_conflict) --
 * so a stale one has to go before a retry can succeed.
 */
async function cleanupStaleFactor(supabase: SupabaseClient) {
  const { data } = await supabase.auth.mfa.listFactors();
  const stale = data?.all.filter((f) => f.factor_type === 'totp' && f.status === 'unverified') ?? [];
  await Promise.all(stale.map((f) => supabase.auth.mfa.unenroll({ factorId: f.id })));
  clearDraft();
}

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
  // True only while resuming a saved draft is in flight, so a reload
  // mid-setup -- e.g. switching to the authenticator app on mobile -- can
  // restore the same QR/secret instead of silently landing back on "Begin
  // setup" and generating a new one (which would orphan the entry already
  // added to the user's authenticator app). Starts false (matching SSR,
  // which has no sessionStorage) and flips inside the effect below so the
  // client's first render always matches the server's.
  const [resuming, setResuming] = useState(false);

  useEffect(() => {
    const draft = readDraft();
    if (!draft) return;
    setResuming(true);

    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase.auth.mfa.listFactors();
      const stillPending = data?.all.some(
        (f) => f.id === draft.factorId && f.factor_type === 'totp' && f.status === 'unverified'
      );
      if (cancelled) return;

      if (stillPending) {
        setFactorId(draft.factorId);
        setQrCode(draft.qrCode);
        setSecret(draft.secret);
        setStep('verify');
      } else {
        // Verified, expired, or cleaned up from elsewhere since this tab
        // last saw it -- nothing valid to resume.
        clearDraft();
      }
      setResuming(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function startEnrollment() {
    setPending(true);
    setError(null);
    const supabase = createClient();
    await cleanupStaleFactor(supabase);

    let { data, error: enrollError } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
    });

    // Another tab/session enrolled in the moment between cleanup and this
    // call -- clean up once more and retry before giving up.
    if (enrollError?.code === 'mfa_factor_name_conflict') {
      await cleanupStaleFactor(supabase);
      ({ data, error: enrollError } = await supabase.auth.mfa.enroll({ factorType: 'totp' }));
    }
    setPending(false);

    if (enrollError || !data) {
      if (enrollError) console.error('MFA enroll failed:', enrollError.code, enrollError.message);
      setError('Could not start MFA setup. Try again.');
      return;
    }
    setFactorId(data.id);
    setQrCode(data.totp.qr_code);
    setSecret(data.totp.secret);
    writeDraft({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret });
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

    clearDraft();
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

  if (resuming) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Set up two-factor authentication</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="mx-auto h-48 w-48" />
          <Skeleton className="h-9 w-full" />
        </CardContent>
      </Card>
    );
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
