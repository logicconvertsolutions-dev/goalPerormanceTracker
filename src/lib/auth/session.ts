import { createClient } from '@/lib/supabase/server';
import type { Database } from '../../../types/database';

export type Agent = Database['public']['Tables']['agents']['Row'];

export interface SessionAgent {
  userId: string;
  email: string;
  agent: Agent | null;
  mfaVerified: boolean;
  /** True when a verified TOTP factor already exists, regardless of this
   * session's AAL — distinguishes "never enrolled" from "enrolled, this
   * session just hasn't stepped up yet" so guards can send the user to the
   * right screen (enroll vs. verify). */
  mfaEnrolled: boolean;
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
  const { data: factors } = await supabase.auth.mfa.listFactors();

  return {
    userId: user.id,
    email: user.email ?? '',
    agent: agent ?? null,
    mfaVerified: aal?.currentLevel === 'aal2',
    mfaEnrolled: (factors?.totp?.some((f) => f.status === 'verified') ?? false),
  };
}
