'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { createClient } from '@/lib/supabase/client';
import { acceptInvitation } from './actions';

export function AcceptInviteForm({ token, email }: { token: string; email: string }) {
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const timeZone =
        typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined;
      const result = await acceptInvitation({ token, fullName, password, agreedToTerms: agreed, timeZone });

      if (!result.ok) {
        if (result.error === 'expired') {
          setError('This invitation has expired. Ask your SMD to send a new one.');
        } else if (result.error === 'already-accepted') {
          router.push('/login');
        } else {
          setError(result.error ?? 'Something went wrong. Try again.');
        }
        return;
      }

      // Account now exists; sign in with the password just set.
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (signInError) {
        router.push('/login');
        return;
      }
      router.push('/onboarding');
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" value={email} disabled readOnly />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="full-name">Full name</Label>
        <Input
          id="full-name"
          required
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <div className="flex items-start gap-2">
        <Checkbox
          id="privacy"
          checked={agreed}
          onCheckedChange={(v) => setAgreed(v === true)}
        />
        <Label htmlFor="privacy" className="font-normal text-fg-2">
          I accept the{' '}
          <Link href="/terms" target="_blank" className="text-acc hover:underline">
            Terms &amp; Conditions
          </Link>{' '}
          and{' '}
          <Link href="/privacy" target="_blank" className="text-acc hover:underline">
            privacy notice
          </Link>
          . My SMD sees my numbers, never my contacts.
        </Label>
      </div>
      {error && <p className="text-sm text-bad">{error}</p>}
      <Button
        type="submit"
        variant="primary"
        className="w-full"
        disabled={pending || !agreed}
      >
        {pending ? 'Creating account…' : 'Accept and continue'}
      </Button>
    </form>
  );
}
