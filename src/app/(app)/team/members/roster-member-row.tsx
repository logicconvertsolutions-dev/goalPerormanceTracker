'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  inviteRosterMemberAction,
  removeRosterMemberAction,
  sendRosterTrainingReminderAction,
} from './actions';

export interface RosterMember {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  invitation_id: string | null;
}

export function RosterMemberRow({ member }: { member: RosterMember }) {
  const [pending, startTransition] = useTransition();

  function handleInvite() {
    if (!member.email) return;
    const formData = new FormData();
    formData.set('rosterId', member.id);
    formData.set('email', member.email);
    startTransition(async () => {
      const result = await inviteRosterMemberAction(formData);
      if (result.ok) {
        toast.success(`Invited ${member.full_name}`);
      } else {
        toast.error(result.error ?? 'Could not send invite.');
      }
    });
  }

  function handleSendReminder() {
    startTransition(async () => {
      const result = await sendRosterTrainingReminderAction(member.id);
      if (result.ok) {
        toast.success(`Training reminder sent to ${member.full_name}`);
      } else {
        toast.error(result.message ?? 'Could not send reminder — try again');
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
        <p className="truncate text-fg">{member.full_name}</p>
        <p className="truncate text-fg-3 text-xs">{member.email}{member.phone ? ` · ${member.phone}` : ''}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {member.invitation_id && <Badge variant="ok">Invited</Badge>}
        <Button variant="soft" size="sm" disabled={pending} onClick={handleSendReminder}>
          Send reminder
        </Button>
        {!member.invitation_id && (
          <Button variant="ghost" size="sm" disabled={pending} onClick={handleInvite}>
            Invite
          </Button>
        )}
        <Button variant="ghost" size="sm" disabled={pending} onClick={handleRemove}>
          Remove
        </Button>
      </div>
    </div>
  );
}
