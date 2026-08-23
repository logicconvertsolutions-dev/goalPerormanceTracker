'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from '@/components/ui/dialog';
import { resetMfaAction } from './actions';

export function ResetMfaButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function reset() {
    startTransition(async () => {
      const result = await resetMfaAction();
      if (result.ok) {
        toast.success('Two-factor authentication reset — set up a new authenticator now.');
        router.push('/mfa/setup');
      } else {
        toast.error(result.error ?? 'Could not reset — try again');
      }
    });
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-bad hover:text-bad">
          Reset
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset two-factor authentication?</DialogTitle>
          <DialogDescription>
            This removes your current authenticator. You&apos;ll set up a new one immediately
            after — don&apos;t do this unless you&apos;re ready to scan a new QR code.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button variant="destructive" disabled={pending} onClick={reset}>
              Reset
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
