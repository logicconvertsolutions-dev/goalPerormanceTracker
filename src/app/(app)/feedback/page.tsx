import { requireVerifiedAgent } from '@/lib/auth/guards';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/shell/page-header';
import { FeedbackForm } from './feedback-form';

export default async function FeedbackPage() {
  await requireVerifiedAgent();

  return (
    <div className="max-w-lg space-y-4">
      <PageHeader
        title="Send feedback"
        subtitle="Report a bug, request a feature, or tell us what's on your mind. An admin will see it."
      />
      <Card>
        <CardContent className="pt-4">
          <FeedbackForm />
        </CardContent>
      </Card>
    </div>
  );
}
