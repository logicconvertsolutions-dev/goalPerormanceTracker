'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { confirmEmailChangeAction } from './actions';

export function ConfirmEmailChangeForm({ token, newEmail }: { token: string; newEmail: string }) {
  const [state, setState] = useState<'idle' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleConfirm() {
    startTransition(async () => {
      const result = await confirmEmailChangeAction(token);
      if (result.ok) {
        setState('done');
      } else {
        setState('error');
        setError(result.error ?? 'Something went wrong. Try again.');
      }
    });
  }

  if (state === 'done') {
    return (
      <div className="text-center space-y-3">
        <h1 className="text-xl font-semibold text-fg">Email updated</h1>
        <p className="text-sm text-fg-2">
          Your login email is now <strong>{newEmail}</strong>.{' '}
          <a href="/login" className="text-acc hover:underline">
            Sign in
          </a>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h1 className="text-xl font-semibold tracking-heading-tight text-fg">Confirm your new email</h1>
        <p className="text-sm text-fg-2">
          An admin requested to change your account&apos;s email to <strong>{newEmail}</strong>. Confirm
          below to make the switch, or ignore this page if you weren&apos;t expecting it.
        </p>
      </div>
      {state === 'error' && error && <p className="text-sm text-bad">{error}</p>}
      <Button variant="primary" className="w-full" disabled={pending} onClick={handleConfirm}>
        {pending ? 'Confirming…' : 'Confirm email change'}
      </Button>
    </div>
  );
}
