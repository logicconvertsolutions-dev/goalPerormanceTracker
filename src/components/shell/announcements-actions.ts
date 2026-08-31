'use server';

import { z } from 'zod';
import { getSessionAgent } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';

const schema = z.object({ announcementId: z.string().uuid() });

export async function dismissAnnouncementAction(
  input: z.infer<typeof schema>
): Promise<{ ok: boolean }> {
  const session = await getSessionAgent();
  if (!session?.agent) return { ok: false };

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false };

  const supabase = await createClient();
  const { error } = await supabase.from('announcement_dismissals').upsert(
    { announcement_id: parsed.data.announcementId, agent_id: session.agent.id },
    { onConflict: 'announcement_id,agent_id' }
  );
  return { ok: !error };
}
