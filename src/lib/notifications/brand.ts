import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';

// Mirrors tailwind.config.ts's navy/gold tokens -- the app's actual theme,
// not a placeholder palette. Keep in sync with tailwind.config.ts colors.acc
// / colors.gold if either changes.
export const BRAND = {
  name: 'Kautis',
  navy: '#0B1E3D',
  gold: '#C9A227',
  bg: '#FFFFFF',
  text: '#14213D',
  muted: '#5C6580',
} as const;

// Org logos live in the private `org-logos` bucket (RLS-scoped to the
// viewer's own org -- see p7d migration). Emails have no session, so this
// signs a URL with the admin client instead of weakening that policy. 7 days
// matches the invite link's own expiry; safe to regenerate per email send.
export async function orgLogoUrl(orgId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data: org } = await admin
    .from('organizations')
    .select('logo_path')
    .eq('id', orgId)
    .maybeSingle();
  if (!org?.logo_path) return null;

  const { data } = await admin.storage
    .from('org-logos')
    .createSignedUrl(org.logo_path, 60 * 60 * 24 * 7);
  return data?.signedUrl ?? null;
}
