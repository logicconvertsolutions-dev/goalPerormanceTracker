'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { inviteRosterMemberAction, removeRosterMemberAction } from './actions';

export interface RosterMember {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  invitation_id: string | null;
}

export function RosterMemberRow({ member }: { member: RosterMember }) {
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState(member.email ?? '');
  const [showEmailInput, setShowEmailInput] = useState(!member.email);

  function handleInvite() {
    if (!email.trim()) {
      setShowEmailInput(true);
      return;
    }
    const formData = new FormData();
    formData.set('rosterId', member.id);
    formData.set('email', email.trim());
    startTransition(async () => {
      const result = await inviteRosterMemberAction(formData);
      if (result.ok) {
        toast.success(`Invited ${member.full_name}`);
      } else {
        toast.error(result.error ?? 'Could not send invite.');
      }
    });
  }

  function handleRemove() {
    startTransition(async () => {
      const result = await removeRosterMemberAction(member.id);
      if (!result.ok) toast.error('Could not remove — try again');
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-line py-2 px-3 text-sm">
      <div className="min-w-0">
        <p className="text-fg">{member.full_name}</p>
        <p className="text-fg-3 text-xs">{member.phone || member.email || '—'}</p>
      </div>
      <div className="flex items-center gap-2">
        {member.invitation_id ? (
          <Badge variant="ok">Invited</Badge>
        ) : (
          <>
            {showEmailInput && (
              <Input
                type="email"
                placeholder="Email to invite"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-9 w-44 text-xs"
              />
            )}
            <Button variant="soft" size="sm" disabled={pending} onClick={handleInvite}>
              Invite
            </Button>
            <Button variant="ghost" size="sm" disabled={pending} onClick={handleRemove}>
              Remove
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
