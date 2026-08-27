'use server';

import { randomBytes, createHash } from 'crypto';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

const RECOVERY_CODE_COUNT = 8;

function generateCode(): string {
  // 10 chars, grouped for readability: XXXXX-XXXXX
  const raw = randomBytes(6).toString('hex').toUpperCase().slice(0, 10);
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

/**
 * Called once, right after mfa.verify() succeeds on the client. Generates
 * and stores 8 hashed recovery codes, returning the plaintext set exactly
 * once — the caller must show these to the user now; they are never
 * retrievable again.
 *
 * Guards against being called directly (bypassing the enroll flow): requires
 * a verified TOTP factor to actually exist for this user, and deletes any
 * prior batch first so an old set can't remain valid alongside a new one.
 */
export async function generateRecoveryCodes(): Promise<string[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // listFactors()'s `totp` array is typed to verified factors only
  // (Factor<'totp', 'verified'>[]) -- a non-empty array here means the user
  // has actually completed mfa.verify(), not just mfa.enroll().
  const { data: factorsData } = await supabase.auth.mfa.listFactors();
  if (!factorsData?.totp?.length) {
    throw new Error('MFA must be verified before generating recovery codes.');
  }

  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, generateCode);

  // Written via the admin client: authenticated has no insert policy on
  // mfa_recovery_codes by design, same pattern as daily_metrics.
  const admin = createAdminClient();
  await admin.from('mfa_recovery_codes').delete().eq('agent_id', user.id);
  await admin.from('mfa_recovery_codes').insert(
    codes.map((code) => ({
      agent_id: user.id,
      code_hash: createHash('sha256').update(code).digest('hex'),
    }))
  );

  return codes;
}
