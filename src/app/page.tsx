import { redirect } from 'next/navigation';
import { getSessionAgent } from '@/lib/auth/session';

export default async function RootPage() {
  const session = await getSessionAgent();
  if (!session?.agent) redirect('/login');
  redirect(session.agent.role === 'admin' ? '/admin/agents' : '/today');
}
