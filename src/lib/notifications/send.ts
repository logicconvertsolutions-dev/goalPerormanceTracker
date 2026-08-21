import 'server-only';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
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
    }),
  });

  if (!res.ok) {
    throw new Error(`email send failed (${res.status}): ${await res.text()}`);
  }
}
