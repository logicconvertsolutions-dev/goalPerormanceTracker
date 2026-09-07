'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { appUrl } from '@/lib/notifications/app-url';

const emailSchema = z.string().email();

// Runs server-side, unlike the rest of the auth flows (which call the
// browser Supabase client directly) -- deliberately, so a real send failure
// (rate limited, misconfigured SMTP, a broken redirect_to) lands in this
// deployment's server logs. The page never surfaces the result either way
// (never confirms whether an email has an account), so before this the only
// place a failure was visible at all was the requesting browser's own
// devtools console -- nobody actually checks that when a user reports "I
// never got the email."
export async function requestPasswordReset(email: string): Promise<void> {
  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) return;

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: appUrl('/auth/callback?next=/reset-password'),
  });
  if (error) {
    console.error(
      `[forgot-password] resetPasswordForEmail failed (status ${error.status}):`,
      error.message
    );
  }
}
