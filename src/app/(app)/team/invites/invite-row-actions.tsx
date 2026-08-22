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
            const result = await resendInvitationAction(email);
            if (result.ok && result.inviteUrl) {
              navigator.clipboard.writeText(result.inviteUrl);
              toast.success('Invitation resent — link copied too, in case email doesn\'t arrive');
            } else {
              toast.error('Could not resend — try again');
            }
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
