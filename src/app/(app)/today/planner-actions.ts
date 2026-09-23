'use server';

import { revalidatePath } from 'next/cache';
import type { z } from 'zod';
import { requireAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { zonedDateTimeToIso } from '@/lib/dates';
import { createReminderSchema, createTaskSchema, idSchema, toggleTaskSchema } from './planner-schemas';

type Result = { ok: true } | { ok: false; error: string };

function firstError(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Check the form and try again.';
}

// ---------------------------------------------------------------------------
// To Do
// ---------------------------------------------------------------------------

export async function createTaskAction(input: z.input<typeof createTaskSchema>): Promise<Result> {
  const parsed = createTaskSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const session = await requireAgent();
  const supabase = await createClient();
  const { title, kind, dueOn, dueTime, contactId } = parsed.data;

  const { error } = await supabase.from('tasks').insert({
    agent_id: session.agent!.id,
    org_id: session.agent!.org_id!,
    title,
    kind,
    due_on: dueOn,
    due_at: dueTime ? zonedDateTimeToIso(dueOn, dueTime, session.agent!.time_zone) : null,
    contact_id: contactId ?? null,
  });

  revalidatePath('/today');
  return error ? { ok: false, error: 'Could not add the task — try again.' } : { ok: true };
}

export async function toggleTaskAction(input: z.input<typeof toggleTaskSchema>): Promise<Result> {
  const parsed = toggleTaskSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const session = await requireAgent();
  const supabase = await createClient();

  const { error } = await supabase
    .from('tasks')
    .update({ done_at: parsed.data.done ? new Date().toISOString() : null })
    .eq('id', parsed.data.id)
    .eq('agent_id', session.agent!.id);

  revalidatePath('/today');
  return error ? { ok: false, error: 'Could not update the task — try again.' } : { ok: true };
}

export async function deleteTaskAction(id: string): Promise<Result> {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { ok: false, error: 'Task not found.' };
  const session = await requireAgent();
  const supabase = await createClient();

  const { error } = await supabase.from('tasks').delete().eq('id', parsed.data).eq('agent_id', session.agent!.id);

  revalidatePath('/today');
  return error ? { ok: false, error: 'Could not delete the task — try again.' } : { ok: true };
}

// ---------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------

export async function createReminderAction(input: z.input<typeof createReminderSchema>): Promise<Result> {
  const parsed = createReminderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const session = await requireAgent();
  const supabase = await createClient();
  const { title, date, time, leadMinutes, push } = parsed.data;

  const { error } = await supabase.from('reminders').insert({
    agent_id: session.agent!.id,
    org_id: session.agent!.org_id!,
    title,
    remind_at: zonedDateTimeToIso(date, time, session.agent!.time_zone),
    lead_minutes: leadMinutes,
    push,
  });

  revalidatePath('/today');
  return error ? { ok: false, error: 'Could not save the reminder — try again.' } : { ok: true };
}

export async function dismissReminderAction(id: string): Promise<Result> {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { ok: false, error: 'Reminder not found.' };
  const session = await requireAgent();
  const supabase = await createClient();

  const { error } = await supabase
    .from('reminders')
    .update({ dismissed_at: new Date().toISOString() })
    .eq('id', parsed.data)
    .eq('agent_id', session.agent!.id);

  revalidatePath('/today');
  return error ? { ok: false, error: 'Could not dismiss the reminder — try again.' } : { ok: true };
}
