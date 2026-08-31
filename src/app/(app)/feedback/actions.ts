'use server';

import { z } from 'zod';
import { requireVerifiedAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/notifications/send';
import { feedbackNotificationEmail } from '@/lib/notifications/templates';

const feedbackSchema = z.object({
  category: z.enum(['bug', 'feature_request', 'feedback', 'other']),
  subject: z.string().trim().min(1, 'Give it a short subject.').max(200),
  message: z.string().trim().min(1, 'Describe what happened.').max(4000),
  pageUrl: z.string().trim().max(200).optional(),
});

export interface SubmitFeedbackResult {
  ok: boolean;
  error?: string;
}

export async function submitFeedbackAction(formData: FormData): Promise<SubmitFeedbackResult> {
  const session = await requireVerifiedAgent();

  const parsed = feedbackSchema.safeParse({
    category: formData.get('category'),
    subject: formData.get('subject'),
    message: formData.get('message'),
    pageUrl: formData.get('pageUrl') || undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid submission.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.from('feedback').insert({
    agent_id: session.userId,
    org_id: session.agent!.org_id,
    category: parsed.data.category,
    subject: parsed.data.subject,
    message: parsed.data.message,
    page_url: parsed.data.pageUrl ?? null,
  });

  if (error) return { ok: false, error: 'Could not submit — try again.' };

  // Best-effort: a delivery failure shouldn't undo the saved report or make
  // the submit look like it failed (same pattern as nudgeAgentAction).
  try {
    const admin = createAdminClient();
    const { data: admins, error: adminsError } = await admin
      .from('agents')
      .select('email')
      .eq('role', 'admin')
      .eq('status', 'active');
    if (adminsError) throw adminsError;

    if (admins && admins.length > 0) {
      const content = feedbackNotificationEmail({
        reporterName: session.agent!.full_name,
        reporterEmail: session.email,
        category: parsed.data.category,
        subject: parsed.data.subject,
        message: parsed.data.message,
        pageUrl: parsed.data.pageUrl ?? null,
      });
      // allSettled, not all -- one admin with a bad/bouncing address must not
      // sink delivery to every other admin (Promise.all rejects the whole
      // batch on the first failure).
      const results = await Promise.allSettled(
        admins.map((a) =>
          sendEmail({ to: a.email, subject: content.subject, html: content.html, text: content.text })
        )
      );
      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          console.error(`[feedback] failed to notify admin ${admins[i].email}`, r.reason);
        }
      });
    }
  } catch (err) {
    console.error('[feedback] failed to notify admins', err);
  }

  return { ok: true };
}
