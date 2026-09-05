import 'server-only';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  // Set List-Unsubscribe / List-Unsubscribe-Post (RFC 8058) when present --
  // Gmail and Yahoo's bulk-sender rules gate inbox placement on a working
  // one-click unsubscribe for recurring mail; see EmailContent.unsubscribeUrl.
  unsubscribeUrl?: string;
}

/**
 * Sends via Resend's HTTP API directly -- one fetch call, no SDK dependency
 * (CLAUDE.md rule 10: no new dependency without asking). No-ops with a
 * console warning when RESEND_API_KEY/NOTIFICATIONS_FROM_EMAIL aren't
 * configured, so dev and preview environments without email credentials
 * don't crash the cron route or the nudge action.
 */
export async function sendEmail(message: EmailMessage): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.NOTIFICATIONS_FROM_EMAIL;
  if (!apiKey || !from) {
    console.warn(
      `[notifications] email not configured -- skipping send to ${message.to}: ${message.subject}`
    );
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      ...(message.unsubscribeUrl && {
        headers: {
          'List-Unsubscribe': `<${message.unsubscribeUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      }),
    }),
  });

  if (!res.ok) {
    throw new Error(`email send failed (${res.status}): ${await res.text()}`);
  }
}

const RESEND_BATCH_MAX = 100;

/**
 * Sends up to 100 distinct messages in a single Resend API call
 * (POST /emails/batch) instead of one HTTP round-trip per recipient --
 * the difference between a drain tick finishing in ~1 request's latency
 * and one that scales linearly with however many people are due right now.
 * Callers are responsible for chunking to RESEND_BATCH_MAX (see
 * notifications/drain/route.ts) -- this throws rather than silently
 * truncating if handed more, so an oversized chunk fails loudly in tests
 * rather than quietly dropping recipients in production.
 */
export async function sendEmailBatch(messages: EmailMessage[]): Promise<void> {
  if (messages.length === 0) return;
  if (messages.length > RESEND_BATCH_MAX) {
    throw new Error(`sendEmailBatch: ${messages.length} messages exceeds Resend's ${RESEND_BATCH_MAX}/call limit`);
  }

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.NOTIFICATIONS_FROM_EMAIL;
  if (!apiKey || !from) {
    console.warn(`[notifications] email not configured -- skipping batch of ${messages.length}`);
    return;
  }

  const res = await fetch('https://api.resend.com/emails/batch', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(
      messages.map((m) => ({
        from,
        to: m.to,
        subject: m.subject,
        html: m.html,
        text: m.text,
        ...(m.unsubscribeUrl && {
          headers: {
            'List-Unsubscribe': `<${m.unsubscribeUrl}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        }),
      }))
    ),
  });

  if (!res.ok) {
    throw new Error(`batch email send failed (${res.status}): ${await res.text()}`);
  }
}
