'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { createInvitationsAction } from './actions';

export function InviteForm() {
  const [emails, setEmails] = useState('');
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);

    startTransition(async () => {
      const result = await createInvitationsAction(formData);
      if (result.ok) {
        toast.success('Invitation sent');
        setEmails('');
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="emails">Email addresses</Label>
        <textarea
          id="emails"
          name="emails"
          placeholder="one@example.com, or one per line for bulk invites"
          value={emails}
          onChange={(e) => setEmails(e.target.value)}
          rows={3}
          className="w-full rounded-sm border border-line-2 bg-sunken px-3 py-2 text-sm text-fg placeholder:text-fg-4 outline-none focus-visible:border-acc-line"
        />
      </div>
      <Button type="submit" variant="primary" disabled={pending || !emails.trim()}>
        {pending ? 'Sending…' : 'Send invite'}
      </Button>
    </form>
  );
}
