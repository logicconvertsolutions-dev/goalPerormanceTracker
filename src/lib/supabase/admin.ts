import 'server-only';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../../types/database';

// Service-role client. Bypasses RLS entirely — only for the narrow set of
// operations that must run before any session exists (org provisioning) or
// that are explicitly service-role-only at the database grant level
// (provision_org has EXECUTE revoked from authenticated/anon by design).
// Never import this from a 'use client' file.
export function createAdminClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
