'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { updateFeedbackStatusAction } from './actions';

type Status = 'new' | 'reviewed' | 'resolved';

export interface FeedbackRowData {
  id: string;
  category: string;
  subject: string;
  message: string;
  page_url: string | null;
  status: Status;
  created_at: string;
  reporterName: string;
  reporterEmail: string;
  orgName: string | null;
}

export function FeedbackRow({ item }: { item: FeedbackRowData }) {
  const [pending, startTransition] = useTransition();

  function setStatus(status: Status) {
    startTransition(async () => {
      const result = await updateFeedbackStatusAction({ id: item.id, status });
      if (!result.ok) toast.error(result.error ?? 'Could not update — try again.');
    });
  }

  return (
    <Card>
      <CardContent className="space-y-2 pt-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-fg">{item.subject}</p>
            <p className="text-xs text-fg-3">
              {item.reporterName} ({item.reporterEmail}){item.orgName ? ` · ${item.orgName}` : ''} ·{' '}
              {new Date(item.created_at).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="neutral">{item.category.replace('_', ' ')}</Badge>
            <Select value={item.status} onValueChange={(v) => setStatus(v as Status)} disabled={pending}>
              <SelectTrigger className="h-8 w-28 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new">New</SelectItem>
                <SelectItem value="reviewed">Reviewed</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="whitespace-pre-wrap text-sm text-fg-2">{item.message}</p>
        {item.page_url && <p className="text-xs text-fg-3">Page: {item.page_url}</p>}
      </CardContent>
    </Card>
  );
}
