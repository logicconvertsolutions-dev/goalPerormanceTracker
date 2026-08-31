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
import {
  moveAgentAction,
  reactivateAgentAction,
  hardDeleteAgentAction,
  setAgentRoleAction,
} from './actions';

interface SameOrgAgent {
  id: string;
  fullName: string;
}

interface OrgOption {
  id: string;
  name: string;
}

type AgentRole = 'associate' | 'leader' | 'admin';

export function AgentRow({
  agentId,
  fullName,
  role,
  status,
  currentUplineId,
  sameOrgAgents,
  orgs,
}: {
  agentId: string;
  fullName: string;
  role: AgentRole;
  status: 'active' | 'inactive';
  currentUplineId: string | null;
  sameOrgAgents: SameOrgAgent[];
  // Admins aren't part of any organization (org_id/upline_id are nulled on
  // promotion) -- moving one back to associate/leader means picking which
  // org they rejoin, since that was deliberately discarded. Only needed to
  // resolve that one transition; every other role change ignores it.
  orgs?: OrgOption[];
}) {
  const [pending, startTransition] = useTransition();
  const [confirmText, setConfirmText] = useState('');
  const [demoteRole, setDemoteRole] = useState<AgentRole | null>(null);
  const [demoteOrgId, setDemoteOrgId] = useState('');

  function move(newUplineId: string | null) {
    startTransition(async () => {
      const result = await moveAgentAction({ agentId, newUplineId });
      if (result.ok) toast.success(`${fullName} moved`);
      else toast.error(result.error ?? 'Could not move — try again');
    });
  }

  function applyRole(newRole: AgentRole, orgId?: string) {
    startTransition(async () => {
      const result = await setAgentRoleAction({ agentId, role: newRole, orgId });
      if (result.ok) toast.success(`${fullName} is now ${newRole}`);
      else toast.error(result.error ?? 'Could not change role — try again');
    });
  }

  function setRole(newRole: AgentRole) {
    if (role === 'admin' && newRole !== 'admin') {
      setDemoteOrgId('');
      setDemoteRole(newRole);
      return;
    }
    applyRole(newRole);
  }

  return (
    <div className="flex items-center gap-2">
      <Select value={role} onValueChange={(v) => setRole(v as AgentRole)} disabled={pending}>
        <SelectTrigger className="h-8 w-28 text-xs">
          <SelectValue placeholder="Role" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="associate">Associate</SelectItem>
          <SelectItem value="leader">Leader (SMD)</SelectItem>
          <SelectItem value="admin">Admin</SelectItem>
        </SelectContent>
      </Select>

      {role !== 'admin' && (
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
      )}

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

      <Dialog open={demoteRole !== null} onOpenChange={(open) => !open && setDemoteRole(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move {fullName} out of Admin</DialogTitle>
            <DialogDescription>
              Admins aren&apos;t part of any organization, so leaving Admin means picking which one{' '}
              {fullName} rejoins as {demoteRole === 'leader' ? 'Leader (SMD)' : 'Associate'}.
            </DialogDescription>
          </DialogHeader>
          <Select value={demoteOrgId} onValueChange={setDemoteOrgId}>
            <SelectTrigger>
              <SelectValue placeholder="Choose an organization" />
            </SelectTrigger>
            <SelectContent>
              {(orgs ?? []).map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDemoteRole(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={pending || !demoteOrgId}
              onClick={() => {
                applyRole(demoteRole!, demoteOrgId);
                setDemoteRole(null);
              }}
            >
              Move
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
