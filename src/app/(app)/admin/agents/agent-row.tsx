'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
import { moveAgentAction, reactivateAgentAction, hardDeleteAgentAction } from './actions';

interface SameOrgAgent {
  id: string;
  fullName: string;
}

export function AgentRow({
  agentId,
  fullName,
  status,
  currentUplineId,
  sameOrgAgents,
}: {
  agentId: string;
  fullName: string;
  status: 'active' | 'inactive';
  currentUplineId: string | null;
  sameOrgAgents: SameOrgAgent[];
}) {
  const [pending, startTransition] = useTransition();
  const [confirmText, setConfirmText] = useState('');

  function move(newUplineId: string | null) {
    startTransition(async () => {
      const result = await moveAgentAction({ agentId, newUplineId });
      if (result.ok) toast.success(`${fullName} moved`);
      else toast.error(result.error ?? 'Could not move — try again');
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Select
        value={currentUplineId ?? '__none__'}
        onValueChange={(v) => move(v === '__none__' ? null : v)}
        disabled={pending}
      >
        <SelectTrigger className="h-8 w-40 text-xs">
          <SelectValue placeholder="Upline" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">No upline (top-level)</SelectItem>
          {sameOrgAgents.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {a.fullName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {status === 'inactive' && (
        <Button
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await reactivateAgentAction(agentId);
              if (result.ok) toast.success(`${fullName} reactivated`);
              else toast.error(result.error ?? 'Could not reactivate — try again');
            })
          }
        >
          Reactivate
        </Button>
      )}

      <Dialog onOpenChange={() => setConfirmText('')}>
        <DialogTrigger asChild>
          <Button variant="ghost" size="sm" className="text-bad hover:text-bad">
            Hard-delete
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hard-delete {fullName}?</DialogTitle>
            <DialogDescription>
              This permanently erases the agent and everything tied to them — contacts, activity
              history, and daily counts. It cannot be undone and is not the same as deactivation.
              Type <strong>{fullName}</strong> to confirm.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={fullName}
          />
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <DialogClose asChild>
              <Button
                variant="destructive"
                disabled={pending || confirmText !== fullName}
                onClick={() =>
                  startTransition(async () => {
                    const result = await hardDeleteAgentAction(agentId);
                    if (result.ok) toast.success(`${fullName} hard-deleted`);
                    else toast.error(result.error ?? 'Could not hard-delete — try again');
                  })
                }
              >
                Hard-delete
              </Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
