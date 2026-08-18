import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function DashboardPage() {
  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>My numbers</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-fg-2">
          Nothing logged yet this week. Your dashboard fills in as you log calls.
          The full KPI/chart dashboard lands in P4.
        </p>
      </CardContent>
    </Card>
  );
}
