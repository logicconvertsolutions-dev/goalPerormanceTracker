'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from '@/components/ui/dialog';
import { deleteOrgAction } from './actions';

export function DeleteOrgButton({
  orgId,
  orgName,
  agentCount,
}: {
  orgId: string;
  orgName: string;
  agentCount: number;
}) {
  const [pending, startTransition] = useTransition();
  const [confirmText, setConfirmText] = useState('');

  return (
    <Dialog onOpenChange={() => setConfirmText('')}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-bad hover:text-bad">
          Delete
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {orgName}?</DialogTitle>
          <DialogDescription>
            This permanently erases the organization and everything in it —{' '}
            {agentCount} agent{agentCount === 1 ? '' : 's'} and all of their contacts, activity
            history, targets, and invitations. It cannot be undone. Type <strong>{orgName}</strong>{' '}
            to confirm.
          </DialogDescription>
        </DialogHeader>
        <Input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder={orgName}
        />
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button
              variant="destructive"
              disabled={pending || confirmText !== orgName}
              onClick={() =>
                startTransition(async () => {
                  const result = await deleteOrgAction({ orgId, orgName });
                  if (result.ok) toast.success(`${orgName} deleted`);
                  else toast.error(result.error ?? 'Could not delete — try again');
                })
              }
            >
              Delete organization
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
