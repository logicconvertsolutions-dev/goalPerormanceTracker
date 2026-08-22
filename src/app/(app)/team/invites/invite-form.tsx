'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { createInvitationsAction } from './actions';

export function InviteForm() {
  const [emails, setEmails] = useState('');
  const [pending, startTransition] = useTransition();
  const [sentLinks, setSentLinks] = useState<{ email: string; inviteUrl: string }[]>([]);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);

    startTransition(async () => {
      const result = await createInvitationsAction(formData);
      if (result.ok) {
        toast.success('Invitation sent');
        setEmails('');
        setSentLinks(result.invites);
      } else {
        toast.error(result.error);
      }
    });
  }

  function copyLink(url: string) {
    navigator.clipboard.writeText(url);
    toast.success('Invite link copied');
  }

  return (
    <div className="space-y-3">
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

      {sentLinks.length > 0 && (
        <div className="space-y-1.5 rounded-sm border border-line-2 bg-sunken p-3">
          <p className="text-xs text-fg-3">
            If the invite email doesn&apos;t arrive, share this link directly &mdash; it works
            just as well and expires in 7 days.
          </p>
          {sentLinks.map((l) => (
            <div key={l.email} className="flex items-center justify-between gap-2 text-xs">
              <span className="text-fg-2">{l.email}</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => copyLink(l.inviteUrl)}>
                Copy link
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
