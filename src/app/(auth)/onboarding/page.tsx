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
  // effective_from," not an exact week-start, but it should still be the
  // agent's own local today rather than UTC's -- a target that just took
  // effect this Monday could otherwise resolve to last week's for anyone
  // west of UTC late on a Sunday.
  const { data: agent } = await supabase.from('agents').select('time_zone').eq('id', user.id).maybeSingle();

  const { data: target } = await supabase.rpc('my_target', {
    p_week: todayIso(agent?.time_zone),
  });

  return <OnboardingSteps target={target?.[0] ?? null} />;
}
