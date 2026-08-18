import { createClient } from '@/lib/supabase/server';
import type { Database } from '../../../types/database';

export type Agent = Database['public']['Tables']['agents']['Row'];

export interface SessionAgent {
  userId: string;
  email: string;
  agent: Agent | null;
  mfaVerified: boolean;
}

/**
 * Reads the current session and joins the agent row. Returns null when
 * there is no session at all. `agent` is null for a signed-in auth.users
 * row that has no matching agents row (shouldn't happen post-signup, since
 * handle_new_user creates it in the same transaction, but a race on first
 * paint after signUp() is possible before that trigger's insert is visible).
 */
export async function getSessionAgent(): Promise<SessionAgent | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: agent } = await supabase
    .from('agents')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

  return {
    userId: user.id,
    email: user.email ?? '',
    agent: agent ?? null,
    mfaVerified: aal?.currentLevel === 'aal2',
  };
}
