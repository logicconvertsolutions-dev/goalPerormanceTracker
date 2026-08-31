import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Magic-link and password-recovery emails land here first. The browser
// client's `signInWithOtp`/`resetPasswordForEmail` calls use the PKCE flow
// (the @supabase/ssr default), so the emailed link carries a `?code=` param
// that must be exchanged for a session server-side before any cookie-based
// session exists — landing straight on a protected page with an
// unexchanged `code` just bounces through the auth guard back to /login.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/today';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?reason=link-expired`);
}
