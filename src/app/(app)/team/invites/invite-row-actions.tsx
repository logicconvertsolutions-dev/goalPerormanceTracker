'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { resendInvitationAction, revokeInvitationAction } from './actions';

export function InviteRowActions({
  invitationId,
  email,
}: {
  invitationId: string;
  email: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex gap-1">
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            await resendInvitationAction(email);
            toast.success('Invitation resent');
          })
        }
      >
        Resend
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            await revokeInvitationAction(invitationId);
            toast.success('Invitation revoked');
          })
        }
      >
        Revoke
      </Button>
    </div>
  );
}
