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
 */
export async function generateRecoveryCodes(): Promise<string[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, generateCode);

  // Written via the admin client: authenticated has no insert policy on
  // mfa_recovery_codes by design, same pattern as daily_metrics.
  const admin = createAdminClient();
  await admin.from('mfa_recovery_codes').insert(
    codes.map((code) => ({
      agent_id: user.id,
      code_hash: createHash('sha256').update(code).digest('hex'),
    }))
  );

  return codes;
}
