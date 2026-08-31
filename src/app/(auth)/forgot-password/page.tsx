'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createClient } from '@/lib/supabase/client';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const supabase = createClient();
      // Always shows the same confirmation regardless of outcome — never
      // reveals whether the address has an account. Real failures (rate
      // limit, misconfigured email provider) are still logged so they don't
      // vanish silently.
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
      });
      if (error) {
        console.error('[forgot-password] resetPasswordForEmail failed:', error.message);
      }
      setSent(true);
    });
  }

  if (sent) {
    return (
      <div className="text-center space-y-2">
        <h1 className="text-xl font-semibold text-fg">Check your email</h1>
        <p className="text-sm text-fg-2">
          If that email has an account, we&apos;ve sent a link to reset your password.
        </p>
        <a href="/login" className="block text-sm text-acc hover:underline">
          Back to sign in
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-xl font-semibold tracking-heading-tight text-fg">
          Reset your password
        </h1>
        <p className="text-sm text-fg-2">
          Enter your email and we&apos;ll send you a reset link.
        </p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <Button type="submit" variant="primary" className="w-full" disabled={pending}>
          {pending ? 'Sending…' : 'Send reset link'}
        </Button>
        <a href="/login" className="block text-center text-sm text-acc hover:underline">
          Back to sign in
        </a>
      </form>
    </div>
  );
}
