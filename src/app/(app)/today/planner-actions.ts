'use server';

import { revalidatePath } from 'next/cache';
import type { z } from 'zod';
import { requireAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { calendarRange, zonedDateTimeToIso } from '@/lib/dates';
import { fetchCalendarItems, type CalendarItem } from '@/lib/calendar';
import {
  calendarQuerySchema,
  createReminderSchema,
  createTaskSchema,
  idSchema,
  toggleTaskSchema,
  updateReminderSchema,
  updateTaskSchema,
} from './planner-schemas';

type Result = { ok: true } | { ok: false; error: string };

function firstError(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Check the form and try again.';
}

/** Every path that lists tasks or reminders. */
function revalidatePlanner() {
  revalidatePath('/today');
  revalidatePath('/today/tasks');
  revalidatePath('/today/reminders');
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

/** Items for one calendar view (P31). The card fetches through this when you
 * change view/date, so only the calendar reloads -- navigating the page
 * itself would swap in today/loading.tsx and jump the window to the top. */
export async function loadCalendarAction(
  input: z.input<typeof calendarQuerySchema>
): Promise<{ ok: true; items: CalendarItem[] } | { ok: false; error: string }> {
  const parsed = calendarQuerySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const session = await requireAgent();
  const supabase = await createClient();
  const range = calendarRange(parsed.data.view, parsed.data.date);
  const items = await fetchCalendarItems(supabase, session.agent!.id, session.agent!.time_zone, range.from, range.to);
  return { ok: true, items };
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

  revalidatePlanner();
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

  revalidatePlanner();
  return error ? { ok: false, error: 'Could not update the task — try again.' } : { ok: true };
}

export async function deleteTaskAction(id: string): Promise<Result> {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { ok: false, error: 'Task not found.' };
  const session = await requireAgent();
  const supabase = await createClient();

  const { error } = await supabase.from('tasks').delete().eq('id', parsed.data).eq('agent_id', session.agent!.id);

  revalidatePlanner();
  return error ? { ok: false, error: 'Could not delete the task — try again.' } : { ok: true };
}

export async function updateTaskAction(input: z.input<typeof updateTaskSchema>): Promise<Result> {
  const parsed = updateTaskSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const session = await requireAgent();
  const supabase = await createClient();
  const { id, title, kind, dueOn, dueTime } = parsed.data;

  const { error } = await supabase
    .from('tasks')
    .update({
      title,
      kind,
      due_on: dueOn,
      due_at: dueTime ? zonedDateTimeToIso(dueOn, dueTime, session.agent!.time_zone) : null,
    })
    .eq('id', id)
    .eq('agent_id', session.agent!.id);

  revalidatePlanner();
  return error ? { ok: false, error: 'Could not save the task — try again.' } : { ok: true };
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

  revalidatePlanner();
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

  revalidatePlanner();
  return error ? { ok: false, error: 'Could not dismiss the reminder — try again.' } : { ok: true };
}

/** Edits a reminder. Changing its time or lead re-arms the push: the
 * reminders_rearm trigger clears sent_at (P30 migration). */
export async function updateReminderAction(input: z.input<typeof updateReminderSchema>): Promise<Result> {
  const parsed = updateReminderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const session = await requireAgent();
  const supabase = await createClient();
  const { id, title, date, time, leadMinutes, push } = parsed.data;

  const { error } = await supabase
    .from('reminders')
    .update({
      title,
      remind_at: zonedDateTimeToIso(date, time, session.agent!.time_zone),
      lead_minutes: leadMinutes,
      push,
      // Editing a completed reminder brings it back as upcoming.
      dismissed_at: null,
    })
    .eq('id', id)
    .eq('agent_id', session.agent!.id);

  revalidatePlanner();
  return error ? { ok: false, error: 'Could not save the reminder — try again.' } : { ok: true };
}

export async function deleteReminderAction(id: string): Promise<Result> {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { ok: false, error: 'Reminder not found.' };
  const session = await requireAgent();
  const supabase = await createClient();

  const { error } = await supabase.from('reminders').delete().eq('id', parsed.data).eq('agent_id', session.agent!.id);

  revalidatePlanner();
  return error ? { ok: false, error: 'Could not delete the reminder — try again.' } : { ok: true };
}
