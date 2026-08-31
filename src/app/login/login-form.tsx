'use client';

import { useState, useTransition } from 'react';
import { useSearchParams } from 'next/navigation';
import { Mail, Lock, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createClient } from '@/lib/supabase/client';

type Mode = 'password' | 'magic-link';

const REASON_COPY: Record<string, string> = {
  deactivated: 'This account is no longer active. Contact your SMD.',
  'signed-out': "You're signed out.",
};

export function LoginForm() {
  const searchParams = useSearchParams();
  const reason = searchParams.get('reason');

  const [mode, setMode] = useState<Mode>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(
    reason ? REASON_COPY[reason] ?? null : null
  );
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [pending, startTransition] = useTransition();

  async function handlePasswordSignIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const supabase = createClient();
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        if (signInError.status === 429) {
          setError('Too many attempts. Try again in 15 minutes, or use a sign-in link.');
        } else {
          // Never confirm which of email/password was wrong.
          setError("Email or password doesn't match.");
        }
        return;
      }

      const agentId = data.user?.id;
      if (agentId) {
        const { data: agent } = await supabase
          .from('agents')
          .select('status')
          .eq('id', agentId)
          .maybeSingle();

        if (agent?.status === 'inactive') {
          await supabase.auth.signOut();
          setError('This account is no longer active. Contact your SMD.');
          return;
        }
      }

      window.location.href = '/today';
    });
  }

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const supabase = createClient();
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}/today` },
      });

      if (otpError) {
        if (otpError.status === 429) {
          setError('Too many attempts. Try again in 15 minutes, or use a sign-in link.');
        } else {
          setError('Something went wrong sending your link. Try again.');
        }
        return;
      }
      setMagicLinkSent(true);
    });
  }

  if (magicLinkSent) {
    return (
      <div className="text-center space-y-4">
        <p className="text-fg">Check your email for a sign-in link.</p>
        <p className="text-sm text-fg-2">Sent to {email}</p>
        <button
          type="button"
          className="text-sm text-acc hover:underline"
          onClick={() => {
            setMagicLinkSent(false);
            setMode('password');
          }}
        >
          Back to sign in
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {mode === 'password' ? (
        <form onSubmit={handlePasswordSignIn} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <div className="relative">
              <Mail
                className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-fg-4"
                aria-hidden="true"
              />
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                className="pl-10"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <Lock
                className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-fg-4"
                aria-hidden="true"
              />
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                className="pl-10 pr-10"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-4 hover:text-fg-2"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  <EyeOff className="h-[18px] w-[18px]" aria-hidden="true" />
                ) : (
                  <Eye className="h-[18px] w-[18px]" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>
          {error && <p className="text-sm text-bad">{error}</p>}
          <Button type="submit" variant="primary" size="lg" className="w-full" disabled={pending}>
            {pending ? 'Signing in…' : 'Sign in'}
          </Button>
          <div className="flex items-center justify-between text-sm">
            <button
              type="button"
              className="text-acc hover:underline"
              onClick={() => {
                setMode('magic-link');
                setError(null);
              }}
            >
              Email me a sign-in link
            </button>
            <a href="/forgot-password" className="text-fg-2 hover:text-fg">
              Forgot password?
            </a>
          </div>
        </form>
      ) : (
        <form onSubmit={handleMagicLink} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="magic-email">Email</Label>
            <div className="relative">
              <Mail
                className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-fg-4"
                aria-hidden="true"
              />
              <Input
                id="magic-email"
                type="email"
                autoComplete="email"
                required
                className="pl-10"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>
          {error && <p className="text-sm text-bad">{error}</p>}
          <Button type="submit" variant="primary" size="lg" className="w-full" disabled={pending}>
            {pending ? 'Sending…' : 'Send sign-in link'}
          </Button>
          <button
            type="button"
            className="text-sm text-acc hover:underline"
            onClick={() => {
              setMode('password');
              setError(null);
            }}
          >
            Use a password instead
          </button>
        </form>
      )}
    </div>
  );
}
