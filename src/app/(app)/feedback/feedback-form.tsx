'use client';

import { useState, useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { submitFeedbackAction } from './actions';

// "issue" isn't its own DB category -- it maps to 'bug', it's just friendlier
// copy for someone unsure whether what they hit counts as a bug.
const CATEGORIES = [
  { value: 'bug', label: 'Bug' },
  { value: 'issue', label: 'Something not working' },
  { value: 'feature_request', label: 'Feature request' },
  { value: 'feedback', label: 'General feedback' },
  { value: 'other', label: 'Other' },
];

export function FeedbackForm() {
  const router = useRouter();
  const pathname = usePathname();
  const [category, setCategory] = useState('bug');
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.set('category', category === 'issue' ? 'bug' : category);
    formData.set('pageUrl', pathname);

    startTransition(async () => {
      const result = await submitFeedbackAction(formData);
      if (result.ok) {
        toast.success("Thanks — we've let the team know.");
        router.push('/today');
      } else {
        toast.error(result.error ?? 'Could not submit — try again.');
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="category">Type</Label>
        <Select value={category} onValueChange={setCategory} required>
          <SelectTrigger id="category">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="subject">Subject</Label>
        <Input id="subject" name="subject" required maxLength={200} placeholder="Short summary" />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="message">Details</Label>
        <Textarea
          id="message"
          name="message"
          required
          maxLength={4000}
          rows={6}
          placeholder="What happened? What did you expect instead?"
        />
      </div>

      <Button type="submit" variant="primary" className="w-full" disabled={pending}>
        {pending ? 'Sending…' : 'Submit'}
      </Button>
    </form>
  );
}
