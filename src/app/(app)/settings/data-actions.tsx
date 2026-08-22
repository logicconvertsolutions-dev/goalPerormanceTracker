'use client';

import { useState, useTransition } from 'react';
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
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { deleteMyAccountAction } from './actions';

export function DataActions() {
  const [pending, startTransition] = useTransition();
  const [confirmText, setConfirmText] = useState('');

  return (
    <div className="space-y-3">
      <div>
        <Button variant="secondary" asChild>
          <a href="/settings/export">Download everything</a>
        </Button>
        <p className="text-xs text-fg-3 mt-1">JSON of everything you&apos;ve logged.</p>
      </div>
      <div>
        <Dialog onOpenChange={() => setConfirmText('')}>
          <DialogTrigger asChild>
            <Button variant="destructive">Delete my account</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete your account?</DialogTitle>
              <DialogDescription>
                This deletes your contacts and notes for good. Your SMD keeps the anonymised
                daily counts they already saw — never your contacts or notes. You&apos;ll be
                signed out immediately. Type <strong>DELETE</strong> to confirm.
              </DialogDescription>
            </DialogHeader>
            <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="DELETE" />
            <DialogFooter>
              <Button
                variant="destructive"
                disabled={pending || confirmText !== 'DELETE'}
                onClick={() =>
                  startTransition(async () => {
                    const result = await deleteMyAccountAction();
                    if (result && !result.ok) {
                      toast.error(result.error ?? 'Could not delete — try again');
                    }
                    // On success the action redirects to /login itself.
                  })
                }
              >
                Delete my account
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <p className="text-xs text-fg-3 mt-1">
          Deletes your contacts and notes. Your SMD keeps the anonymised daily counts they
          already saw.
        </p>
      </div>
    </div>
  );
}
