'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getSessionAgent } from '@/lib/auth/session';

const nameSchema = z.object({ name: z.string().min(1).max(200) });

export async function updateOrgNameAction(formData: FormData) {
  const parsed = nameSchema.safeParse({ name: formData.get('name') });
  if (!parsed.success) return { ok: false, error: 'Enter an organization name.' };

  const session = await getSessionAgent();
  if (!session?.agent) return { ok: false, error: 'Not signed in.' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('organizations')
    .update({ name: parsed.data.name })
    .eq('id', session.agent.org_id);

  revalidatePath('/team/organization');
  revalidatePath('/', 'layout');
  return { ok: !error, error: error?.message };
}

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
// Matches the org-logos bucket's file_size_limit (p8a migration). 2MB was too
// tight for a logo exported straight off a phone camera.
const MAX_BYTES = 5 * 1024 * 1024;

export async function uploadOrgLogoAction(formData: FormData) {
  const session = await getSessionAgent();
  if (!session?.agent) return { ok: false, error: 'Not signed in.' };

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'Choose an image to upload.' };
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return { ok: false, error: 'Use a PNG, JPEG, WebP, or SVG image.' };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: 'Image must be under 5MB.' };
  }

  const supabase = await createClient();
  const ext = file.type.split('/')[1] === 'svg+xml' ? 'svg' : file.type.split('/')[1];
  const path = `${session.agent.org_id}/logo.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from('org-logos')
    .upload(path, file, { upsert: true, contentType: file.type });
  if (uploadError) return { ok: false, error: uploadError.message };

  const { error } = await supabase
    .from('organizations')
    .update({ logo_path: path })
    .eq('id', session.agent.org_id);

  revalidatePath('/team/organization');
  revalidatePath('/', 'layout');
  return { ok: !error, error: error?.message };
}
