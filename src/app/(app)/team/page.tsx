import Link from 'next/link';
import { requireLeader } from '@/lib/auth/guards';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default async function TeamPage() {
  await requireLeader();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-heading-tight text-fg">Team</h1>
        <div className="flex gap-2">
          <Button variant="secondary" asChild>
            <Link href="/team/invites">Invites</Link>
          </Button>
          <Button variant="secondary" asChild>
            <Link href="/team/members">Members</Link>
          </Button>
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Roster</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-fg-2">
            The full roster with calls/appointments/premium and % to goal lands in
            P5. This route enforces the leader + MFA gate now.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
