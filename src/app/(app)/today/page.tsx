import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function TodayPage() {
  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>Today</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-fg-2">
          Nothing due today. Set a follow-up when you log a call and it&apos;ll show
          up here. The real callback queue lands in P2.5.
        </p>
      </CardContent>
    </Card>
  );
}
