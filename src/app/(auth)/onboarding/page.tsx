import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { todayIso } from '@/lib/dates';
import { OnboardingSteps } from './onboarding-steps';

export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  // effective_target just needs "some date on/after the target's
  // effective_from," not an exact cycle-start, but it should still be the
  // agent's own local today rather than UTC's -- a target that just took
  // effect this cycle could otherwise resolve to last cycle's for anyone
  // west of UTC late in the day.
  const { data: agent } = await supabase.from('agents').select('time_zone').eq('id', user.id).maybeSingle();

  const { data: target } = await supabase.rpc('my_target', {
    p_period_start: todayIso(agent?.time_zone),
  });

  return <OnboardingSteps target={target?.[0] ?? null} />;
}
