'use client';

import { useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { adminAddRosterMemberAction } from './actions';

interface Leader {
  id: string;
  fullName: string;
}

/** Admin's equivalent of /team/members' RosterForm — adds a team member to
 * one specific org's roster, same "no email sent yet" semantics, plus
 * picking which of that org's leaders (SMD) the new member reports to. */
export function AdminRosterForm({ orgId, leaders }: { orgId: string; leaders: Leader[] }) {
  const [pending, startTransition] = useTransition();
  const [uplineId, setUplineId] = useState(leaders.length === 1 ? leaders[0].id : '');
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!uplineId) {
      toast.error('Choose who this person reports to.');
      return;
    }
    const formData = new FormData(e.currentTarget);
    formData.set('orgId', orgId);
    formData.set('uplineId', uplineId);

    startTransition(async () => {
      const result = await adminAddRosterMemberAction(formData);
      if (result.ok) {
        toast.success('Added to roster');
        formRef.current?.reset();
        if (leaders.length !== 1) setUplineId('');
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label htmlFor="fullName">Name</Label>
        <Input id="fullName" name="fullName" placeholder="Full name" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" placeholder="name@example.com" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="phone">Phone (optional)</Label>
        <Input id="phone" name="phone" type="tel" placeholder="Phone" />
      </div>
      {leaders.length > 1 ? (
        <div className="space-y-1.5">
          <Label htmlFor="uplineId">Reports to</Label>
          <Select value={uplineId} onValueChange={setUplineId}>
            <SelectTrigger id="uplineId">
              <SelectValue placeholder="Choose an SMD" />
            </SelectTrigger>
            <SelectContent>
              {leaders.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.fullName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : (
        <div className="flex items-end">
          <p className="text-xs text-fg-3">Reports to {leaders[0]?.fullName}</p>
        </div>
      )}
      <div className="sm:col-span-2">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? 'Adding…' : 'Add'}
        </Button>
      </div>
    </form>
  );
}
