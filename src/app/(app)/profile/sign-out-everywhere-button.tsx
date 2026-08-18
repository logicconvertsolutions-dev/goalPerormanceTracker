'use client';

import { useTransition } from 'react';
import { signOutEverywhereAction } from './actions';

export function SignOutEverywhereButton() {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await signOutEverywhereAction();
          window.location.href = '/login?reason=signed-out';
        })
      }
      className="inline-flex h-11 items-center justify-center rounded-sm border border-bad bg-bad-dim px-4 text-sm font-medium text-bad transition-smooth hover:bg-bad/20 disabled:opacity-50"
    >
      {pending ? 'Signing out…' : 'Sign out everywhere'}
    </button>
  );
}
