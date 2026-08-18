'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
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
import { deactivateAgentAction } from './actions';

export function DeactivateButton({
  agentId,
  fullName,
}: {
  agentId: string;
  fullName: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          Deactivate
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Deactivate {fullName}?</DialogTitle>
          <DialogDescription>
            Their access is revoked immediately and they disappear from the
            roster. Their activity history is retained for your aggregate
            reporting.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await deactivateAgentAction(agentId);
                  if (result.ok) {
                    toast.success(`${fullName} deactivated`);
                  } else {
                    toast.error('Could not deactivate — try again');
                  }
                })
              }
            >
              Deactivate
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
