import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { OnboardingSteps } from './onboarding-steps';

export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: target } = await supabase.rpc('my_target', {
    p_week: new Date().toISOString().slice(0, 10),
  });

  return <OnboardingSteps target={target?.[0] ?? null} />;
}
