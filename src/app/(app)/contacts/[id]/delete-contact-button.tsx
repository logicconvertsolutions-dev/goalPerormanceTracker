'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { deleteContactAction } from '../actions';

/**
 * When there's no history to lose, deleting is a single confirm click. Once
 * there's a call or appointment on this contact, the dialog spells out that
 * deleting also deletes those (contact_id ... on delete cascade) rather than
 * just orphaning them, since that's the part that isn't obvious/reversible.
 */
export function DeleteContactButton({
  contactId,
  fullName,
  callCount,
  appointmentCount,
}: {
  contactId: string;
  fullName: string;
  callCount: number;
  appointmentCount: number;
}) {
  const [pending, startTransition] = useTransition();
  const hasLogs = callCount > 0 || appointmentCount > 0;

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteContactAction(contactId);
      // On success the action redirects to /contacts itself.
      if (result && !result.ok) {
        toast.error(result.error ?? 'Could not delete — try again');
      }
    });
  }

  const parts: string[] = [];
  if (callCount > 0) parts.push(`${callCount} call${callCount === 1 ? '' : 's'}`);
  if (appointmentCount > 0) parts.push(`${appointmentCount} appointment${appointmentCount === 1 ? '' : 's'}`);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-bad hover:text-bad">
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          Delete
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {fullName}?</DialogTitle>
          <DialogDescription>
            {hasLogs ? (
              <>
                This contact has {parts.join(' and ')} logged against it. Deleting the contact also
                permanently deletes {parts.length > 1 ? 'those' : 'that'} — this can&apos;t be undone.
                Any sales or recruiting conversations tied to {fullName} are kept, just no longer
                linked to this contact.
              </>
            ) : (
              <>This can&apos;t be undone.</>
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button variant="destructive" disabled={pending} onClick={handleDelete}>
            {pending ? 'Deleting…' : 'Delete contact'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
