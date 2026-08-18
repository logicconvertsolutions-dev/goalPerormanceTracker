import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function LogPage() {
  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>Quick log</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-fg-2">
          Call, appointment, and sale logging lands in P3. This route exists now
          so onboarding and the app shell have somewhere to send you.
        </p>
      </CardContent>
    </Card>
  );
}
