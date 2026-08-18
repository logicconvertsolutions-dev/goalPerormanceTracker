'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { provisionOrgAction } from './actions';

export function ProvisionOrgForm() {
  const [orgName, setOrgName] = useState('');
  const [smdEmail, setSmdEmail] = useState('');
  const [smdName, setSmdName] = useState('');
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await provisionOrgAction({ orgName, smdEmail, smdName });
      if (result.ok) {
        toast.success(`${orgName} created — invitation sent to ${smdEmail}`);
        setOrgName('');
        setSmdEmail('');
        setSmdName('');
      } else {
        toast.error(result.error ?? 'Could not create organization');
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="orgName">Organization name</Label>
        <Input id="orgName" required value={orgName} onChange={(e) => setOrgName(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="smdName">SMD name</Label>
        <Input id="smdName" required value={smdName} onChange={(e) => setSmdName(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="smdEmail">SMD email</Label>
        <Input
          id="smdEmail"
          type="email"
          required
          value={smdEmail}
          onChange={(e) => setSmdEmail(e.target.value)}
        />
      </div>
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? 'Creating…' : 'Create organization'}
      </Button>
    </form>
  );
}
