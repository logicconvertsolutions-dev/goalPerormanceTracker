import { NextResponse } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

// Magic-link and password-recovery emails land here via `{{ .TokenHash }}` in
// supabase/templates/{magic_link,recovery}.html, not the PKCE `code` flow
// /auth/callback still handles. verifyOtp() checks the token itself and
// doesn't need a code_verifier cookie from the browser that requested it --
// exchangeCodeForSession() does, which is what made these two links fail
// with a generic "expired" error whenever they were opened somewhere other
// than the exact browser that asked for them (a different device, or a mail
// app's in-app browser with its own cookie jar).
function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/today';
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const token_hash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  const next = safeNext(searchParams.get('next'));

  if (token_hash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?reason=link-expired`);
}
