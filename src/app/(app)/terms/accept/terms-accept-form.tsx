'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { acceptTermsAction } from './actions';

export function TermsAcceptForm() {
  const router = useRouter();
  const [agreed, setAgreed] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await acceptTermsAction();
      if (!result.ok) {
        toast.error(result.error ?? 'Could not save — try again.');
        return;
      }
      router.push('/today');
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex items-start gap-2">
        <Checkbox id="agree" checked={agreed} onCheckedChange={(v) => setAgreed(v === true)} />
        <Label htmlFor="agree" className="font-normal text-fg-2">
          I accept the Terms &amp; Conditions and Privacy Notice.
        </Label>
      </div>
      <Button type="submit" variant="primary" className="w-full" disabled={pending || !agreed}>
        {pending ? 'Saving…' : 'Agree and continue'}
      </Button>
    </form>
  );
}
