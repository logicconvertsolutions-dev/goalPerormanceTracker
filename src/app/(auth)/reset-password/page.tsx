'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createClient } from '@/lib/supabase/client';

// Supabase's recovery-link flow lands here with a short-lived recovery
// session already established from the emailed link (single-use, 1 hour) —
// there is no separate [token] route param to validate ourselves.
export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });

      if (updateError) {
        setError('This reset link has expired or already been used. Request a new one.');
        return;
      }
      router.push('/login');
    });
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-xl font-semibold tracking-heading-tight text-fg">
          Choose a new password
        </h1>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="password">New password</Label>
          <Input
            id="password"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && <p className="text-sm text-bad">{error}</p>}
        <Button type="submit" variant="primary" className="w-full" disabled={pending}>
          {pending ? 'Saving…' : 'Save password'}
        </Button>
      </form>
    </div>
  );
}
