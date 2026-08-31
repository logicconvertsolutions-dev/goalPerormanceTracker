'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { requestEmailChangeAction } from '../actions';

export function ChangeEmailForm({ agentId, currentEmail }: { agentId: string; currentEmail: string }) {
  const [newEmail, setNewEmail] = useState('');
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await requestEmailChangeAction({ agentId, newEmail });
      if (result.ok) {
        toast.success(`Confirmation sent to ${newEmail}`);
        setNewEmail('');
      } else {
        toast.error(result.error ?? 'Could not start the email change — try again');
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2">
      <div className="space-y-1.5 flex-1 min-w-[200px]">
        <Label htmlFor="new-email">New email</Label>
        <Input
          id="new-email"
          type="email"
          required
          placeholder={currentEmail}
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
        />
      </div>
      <Button type="submit" variant="secondary" disabled={pending || !newEmail}>
        {pending ? 'Sending…' : 'Send confirmation'}
      </Button>
    </form>
  );
}
