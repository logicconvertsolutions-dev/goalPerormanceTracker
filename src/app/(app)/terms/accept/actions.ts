'use server';

import { requireAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';

export interface AcceptTermsResult {
  ok: boolean;
  error?: string;
}

export async function acceptTermsAction(): Promise<AcceptTermsResult> {
  const session = await requireAgent();
  const supabase = await createClient();

  const { error } = await supabase
    .from('agents')
    .update({ terms_accepted_at: new Date().toISOString() })
    .eq('id', session.userId);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
