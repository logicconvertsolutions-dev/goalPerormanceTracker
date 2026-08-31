'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { publishAnnouncementAction } from './actions';

export function PublishAnnouncementForm() {
  const [message, setMessage] = useState('');
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await publishAnnouncementAction({ message });
      if (result.ok) {
        toast.success('Announcement published');
        setMessage('');
      } else {
        toast.error(result.error ?? 'Could not publish — try again');
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <Textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="e.g. We're rolling out a new Contacts view next Monday — nothing to do on your end."
        maxLength={2000}
        rows={3}
        required
      />
      <Button type="submit" variant="primary" disabled={pending || !message.trim()}>
        {pending ? 'Publishing…' : 'Publish to everyone'}
      </Button>
    </form>
  );
}
