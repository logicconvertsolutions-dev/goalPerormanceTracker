import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { composeEveningNudge, composeSundaySummary, composeMondayDigest, type NotifiableAgent } from '@/lib/notifications/compose';
import { sendEmailBatch } from '@/lib/notifications/send';
import type { EmailContent } from '@/lib/notifications/templates';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // safety margin -- a bounded batch should finish in a few seconds

// Bounded per invocation, on purpose (see the migration this route pairs
// with, 20260905090000_p14a_bulk_notification_pipeline.sql): however many
// agents are due right now, this route only ever does a fixed amount of
// work per call. More due agents means more drain ticks process more
// batches -- never one tick doing unboundedly more work, which is what
// made the old per-request loop unsafe at scale.
const QUEUE_NAME = 'notification_sends';
const BATCH_SIZE = 500; // pgmq.read qty per invocation
const VISIBILITY_TIMEOUT_SECONDS = 60; // must exceed how long this route can realistically take
const MAX_ATTEMPTS = 5; // read_ct ceiling before a message is archived as permanently failed
const RESEND_CHUNK_SIZE = 100; // Resend's own /emails/batch cap
const SEND_CONCURRENCY = 5; // parallel Resend batch calls per drain tick

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // no secret configured (local dev) -- don't lock developers out
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

interface QueueMessage {
  msg_id: number;
  read_ct: number;
  enqueued_at: string;
  vt: string;
  message: { agent_id: string; kind: 'evening_nudge' | 'sunday_summary' | 'monday_digest'; local_date: string };
}

interface ComposedSend {
  msgId: number;
  agentId: string;
  kind: QueueMessage['message']['kind'];
  localDate: string;
  to: string;
  content: EmailContent;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data: messages, error: readError } = await admin.rpc('pgmq_read', {
    queue_name: QUEUE_NAME,
    vt: VISIBILITY_TIMEOUT_SECONDS,
    qty: BATCH_SIZE,
  });
  if (readError) {
    console.error('[notifications] drain: pgmq_read failed', readError);
    return NextResponse.json({ error: 'queue read failed' }, { status: 500 });
  }
  const queued = (messages ?? []) as QueueMessage[];
  if (queued.length === 0) {
    return NextResponse.json({ drained: 0, sent: 0, failed: 0 });
  }

  const agentIds = Array.from(new Set(queued.map((m) => m.message.agent_id)));
  const { data: agents } = await admin
    .from('agents')
    .select('id, email, full_name, role, time_zone, status')
    .in('id', agentIds);
  const agentById = new Map((agents ?? []).map((a) => [a.id, a]));

  // Messages that resolve to nothing worth sending (agent deactivated since
  // being claimed, or the compose*() call itself found no data to send --
  // e.g. an SMD with an empty downline) are cleared from the queue as
  // "done," same as a real send, since there's nothing to retry.
  const composed: ComposedSend[] = [];
  const doneNoSend: number[] = [];

  for (const m of queued) {
    const agent = agentById.get(m.message.agent_id);
    if (!agent || agent.status !== 'active') {
      doneNoSend.push(m.msg_id);
      continue;
    }
    const notifiable: NotifiableAgent = { id: agent.id, email: agent.email, full_name: agent.full_name, time_zone: agent.time_zone };
    const composeFn =
      m.message.kind === 'evening_nudge' ? composeEveningNudge
      : m.message.kind === 'sunday_summary' ? composeSundaySummary
      : composeMondayDigest;
    try {
      const result = await composeFn(admin, notifiable, m.message.local_date);
      if (result) {
        composed.push({ msgId: m.msg_id, agentId: agent.id, kind: m.message.kind, localDate: m.message.local_date, to: result.to, content: result.content });
      } else {
        doneNoSend.push(m.msg_id);
      }
    } catch (err) {
      console.error(`[notifications] drain: compose failed for ${agent.id}/${m.message.kind}`, err);
      // Leave uncomposed messages in the queue -- retried on the next tick
      // via the same visibility-timeout mechanism as a failed send below.
    }
  }

  // Bounded-concurrency fan-out to Resend's batch endpoint. Hand-rolled
  // worker pool rather than a library (CLAUDE.md rule 10: no new dependency
  // without asking) -- chunk into Resend-sized groups, then run a fixed
  // number of workers pulling the next unclaimed chunk until none remain.
  const chunks: ComposedSend[][] = [];
  for (let i = 0; i < composed.length; i += RESEND_CHUNK_SIZE) chunks.push(composed.slice(i, i + RESEND_CHUNK_SIZE));

  const outcomeByMsgId = new Map<number, 'sent' | 'failed'>();
  let nextChunk = 0;
  async function worker() {
    while (nextChunk < chunks.length) {
      const chunk = chunks[nextChunk++];
      try {
        await sendEmailBatch(
          chunk.map((c) => ({ to: c.to, subject: c.content.subject, html: c.content.html, text: c.content.text, unsubscribeUrl: c.content.unsubscribeUrl }))
        );
        for (const c of chunk) outcomeByMsgId.set(c.msgId, 'sent');
      } catch (err) {
        console.error('[notifications] drain: batch send failed', err);
        for (const c of chunk) outcomeByMsgId.set(c.msgId, 'failed');
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(SEND_CONCURRENCY, chunks.length) }, worker));

  // Reconcile: delete succeeded/no-send messages, mark notification_log
  // 'sent'; leave genuine failures in the queue (visibility timeout expires,
  // next tick retries) until read_ct hits MAX_ATTEMPTS, then archive +
  // mark 'failed' so it stops retrying forever and shows up for investigation
  // instead of silently disappearing.
  let sent = 0;
  let failed = 0;

  for (const msgId of doneNoSend) {
    await admin.rpc('pgmq_delete', { queue_name: QUEUE_NAME, msg_id: msgId });
  }

  for (const c of composed) {
    const outcome = outcomeByMsgId.get(c.msgId);
    if (outcome === 'sent') {
      await admin.rpc('pgmq_delete', { queue_name: QUEUE_NAME, msg_id: c.msgId });
      await admin.from('notification_log').update({ status: 'sent' }).match({ agent_id: c.agentId, kind: c.kind, local_date: c.localDate });
      sent += 1;
    } else {
      const original = queued.find((q) => q.msg_id === c.msgId)!;
      if (original.read_ct >= MAX_ATTEMPTS) {
        await admin.rpc('pgmq_archive', { queue_name: QUEUE_NAME, msg_id: c.msgId });
        await admin
          .from('notification_log')
          .update({ status: 'failed', attempts: original.read_ct, last_error: 'max attempts exceeded' })
          .match({ agent_id: c.agentId, kind: c.kind, local_date: c.localDate });
        failed += 1;
      }
      // else: left in queue on purpose, retried on a later tick
    }
  }

  return NextResponse.json({ drained: queued.length, composed: composed.length, sent, failed });
}
