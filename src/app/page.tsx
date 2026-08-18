import { redirect } from 'next/navigation';
import { getSessionAgent } from '@/lib/auth/session';

export default async function RootPage() {
  const session = await getSessionAgent();
  redirect(session?.agent ? '/today' : '/login');
}
