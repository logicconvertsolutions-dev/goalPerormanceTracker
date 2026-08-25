'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { uploadOrgLogoAction } from './actions';

export function OrgLogoUpload({ currentLogoUrl }: { currentLogoUrl: string | null }) {
  const [pending, startTransition] = useTransition();
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

  return (
    <div className="flex items-center gap-4">
      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-sm border border-line-2 bg-sunken flex items-center justify-center">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="Organization logo" className="h-full w-full object-contain" />
        ) : (
          <span className="text-xs text-fg-4">No logo</span>
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
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() => inputRef.current?.click()}
        >
          {pending ? 'Uploading…' : 'Upload logo'}
        </Button>
        <p className="text-xs text-fg-3">PNG, JPEG, WebP, or SVG. Under 5MB.</p>
      </div>
    </div>
  );
}
