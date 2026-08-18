'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { updateFullNameAction } from './actions';

export function FullNameForm({ currentName }: { currentName: string }) {
  const [name, setName] = useState(currentName);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await updateFullNameAction(formData);
      if (result.ok) toast.success('Name updated');
      else toast.error(result.error ?? 'Could not update name');
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-2">
      <div className="flex-1 space-y-1.5">
        <Label htmlFor="fullName">Full name</Label>
        <Input
          id="fullName"
          name="fullName"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <Button type="submit" variant="secondary" disabled={pending || name === currentName}>
        {pending ? 'Saving…' : 'Save'}
      </Button>
    </form>
  );
}
