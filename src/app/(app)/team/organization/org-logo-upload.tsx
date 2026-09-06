'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
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
import { KautisMark } from '@/components/shell/kautis-logo';
import { uploadOrgLogoAction, removeOrgLogoAction } from './actions';

export function OrgLogoUpload({ currentLogoUrl }: { currentLogoUrl: string | null }) {
  const [pending, startTransition] = useTransition();
  const [removing, startRemoveTransition] = useTransition();
  const [preview, setPreview] = useState<string | null>(currentLogoUrl);
  const inputRef = useRef<HTMLInputElement>(null);

  // On success the server issues a fresh signed URL and revalidates the
  // page, which flows back here as a new `currentLogoUrl` prop -- pick it
  // up once it arrives so we stop pointing at the (now-revoked) blob
  // preview from handleFileChange.
  useEffect(() => {
    setPreview(currentLogoUrl);
  }, [currentLogoUrl]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const localPreview = URL.createObjectURL(file);
    setPreview(localPreview);

    const formData = new FormData();
    formData.set('file', file);
    startTransition(async () => {
      const result = await uploadOrgLogoAction(formData);
      URL.revokeObjectURL(localPreview);
      if (result.ok) {
        toast.success('Logo updated');
      } else {
        toast.error(result.error ?? 'Could not upload logo');
        setPreview(currentLogoUrl);
      }
    });
  }

  function handleRemove() {
    startRemoveTransition(async () => {
      const result = await removeOrgLogoAction();
      if (result.ok) {
        setPreview(null);
        toast.success('Logo removed');
      } else {
        toast.error(result.error ?? 'Could not remove logo');
      }
    });
  }

  return (
    <div className="flex items-center gap-4">
      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-sm border border-line-2 bg-sunken flex items-center justify-center">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="Organization logo" className="h-full w-full object-contain" />
        ) : (
          <KautisMark size={64} className="h-16 w-16" />
        )}
      </div>
      <div className="space-y-1.5">
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          className="hidden"
          onChange={handleFileChange}
        />
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={() => inputRef.current?.click()}
          >
            {pending ? 'Uploading…' : 'Upload logo'}
          </Button>
          {preview && (
            <Dialog>
              <DialogTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={removing}
                  className="text-bad hover:text-bad"
                >
                  Remove logo
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Remove organization logo?</DialogTitle>
                  <DialogDescription>
                    Your header and branding will show the default Kautis mark until you upload a
                    new logo. This can&apos;t be undone.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="ghost">Cancel</Button>
                  </DialogClose>
                  <DialogClose asChild>
                    <Button variant="destructive" disabled={removing} onClick={handleRemove}>
                      Remove logo
                    </Button>
                  </DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
        <p className="text-xs text-fg-3">PNG, JPEG, WebP, or SVG. Under 5MB.</p>
      </div>
    </div>
  );
}
