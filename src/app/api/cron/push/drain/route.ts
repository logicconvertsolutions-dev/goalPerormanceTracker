import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { toPushPayload } from '@/lib/push/payload';
import { pushConfigured, sendPush, type PushOutcome } from '@/lib/push/send';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Drains the `push_sends` pgmq queue filled by private.enqueue_due_pushes()
// (P30 migration). Same shape as /api/cron/notifications/drain: bounded work
// per call, pinged by pg_cron via private.ping_push_drain() only while the
// queue has something in it.
const QUEUE_NAME = 'push_sends';
const BATCH_SIZE = 200;
const VISIBILITY_TIMEOUT_SECONDS = 60;
const MAX_ATTEMPTS = 5;
const SEND_CONCURRENCY = 10;

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // no secret configured (local dev) -- don't lock developers out
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

interface QueueMessage {
  msg_id: number;
  read_ct: number;
  message: { notification_id: string };
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
    console.error('[push] drain: pgmq_read failed', readError);
    return NextResponse.json({ error: 'queue read failed' }, { status: 500 });
  }
  const queued = (messages ?? []) as unknown as QueueMessage[];
  if (queued.length === 0) return NextResponse.json({ drained: 0, sent: 0 });

  const ids = queued.map((m) => m.message.notification_id);
  const { data: notifications } = await admin
    .from('notifications')
    .select('id, agent_id, kind, title, body, link')
    .in('id', ids);
  const byId = new Map((notifications ?? []).map((n) => [n.id, n]));

  const agentIds = Array.from(new Set((notifications ?? []).map((n) => n.agent_id)));
  const { data: subs } = agentIds.length
    ? await admin.from('push_subscriptions').select('agent_id, endpoint, p256dh, auth').in('agent_id', agentIds)
    : { data: [] };

  // Without VAPID keys nothing can be sent. Close the messages out (the
  // notification still shows in the bell) rather than letting the queue grow
  // and the ping fire every minute forever -- same stance as sendEmail().
  const canSend = pushConfigured();
  if (!canSend) console.warn('[push] VAPID keys not configured -- skipping push delivery');

  // One task per (message, device). Fixed-size worker pool, no dependency.
  type Task = { msgId: number; endpoint: string; run: () => Promise<PushOutcome> };
  const tasks: Task[] = [];
  for (const m of queued) {
    const n = byId.get(m.message.notification_id);
    if (!n || !canSend) continue;
    const payload = toPushPayload(n);
    for (const s of (subs ?? []).filter((x) => x.agent_id === n.agent_id)) {
      tasks.push({ msgId: m.msg_id, endpoint: s.endpoint, run: () => sendPush(s, payload) });
    }
  }

  const outcomes = new Map<number, PushOutcome[]>();
  const goneEndpoints = new Set<string>();
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const t = tasks[next++];
      const outcome = await t.run();
      if (outcome === 'gone') goneEndpoints.add(t.endpoint);
      outcomes.set(t.msgId, [...(outcomes.get(t.msgId) ?? []), outcome]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(SEND_CONCURRENCY, tasks.length) }, worker));

  if (goneEndpoints.size > 0) {
    await admin.from('push_subscriptions').delete().in('endpoint', Array.from(goneEndpoints));
  }

  // A message is done when every device either took it or is gone for good
  // (including "no devices at all"). Any real failure leaves it queued for a
  // retry until MAX_ATTEMPTS, then it is archived. pushed_at is set either
  // way once we stop trying, so the enqueue job never re-queues it.
  let sent = 0;
  const finished: string[] = [];
  for (const m of queued) {
    const results = outcomes.get(m.msg_id) ?? [];
    const failed = results.includes('failed');
    if (!failed) {
      await admin.rpc('pgmq_delete', { queue_name: QUEUE_NAME, msg_id: m.msg_id });
      finished.push(m.message.notification_id);
      sent += results.filter((r) => r === 'sent').length;
    } else if (m.read_ct >= MAX_ATTEMPTS) {
      await admin.rpc('pgmq_archive', { queue_name: QUEUE_NAME, msg_id: m.msg_id });
      finished.push(m.message.notification_id);
    }
  }
  if (finished.length > 0) {
    await admin.from('notifications').update({ pushed_at: new Date().toISOString() }).in('id', finished);
  }

  return NextResponse.json({ drained: queued.length, sent, removedDevices: goneEndpoints.size });
}
