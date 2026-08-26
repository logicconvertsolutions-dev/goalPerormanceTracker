'use client';

import { useRef, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { addRosterMemberAction } from './actions';

/** Adds a team member to the roster — no email, no login. Separate from
 * inviting, which happens per-row once the SMD decides who's ready. */
export function RosterForm() {
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);

    startTransition(async () => {
      const result = await addRosterMemberAction(formData);
      if (result.ok) {
        toast.success('Added to roster');
        formRef.current?.reset();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-3 sm:items-end">
      <div className="space-y-1.5">
        <Label htmlFor="fullName">Name</Label>
        <Input id="fullName" name="fullName" placeholder="Full name" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" placeholder="name@example.com" required />
      </div>
      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="phone">Phone (optional)</Label>
          <Input id="phone" name="phone" type="tel" placeholder="Phone" />
        </div>
        <Button type="submit" variant="primary" disabled={pending} className="shrink-0">
          {pending ? 'Adding…' : 'Add'}
        </Button>
      </div>
    </form>
  );
}
