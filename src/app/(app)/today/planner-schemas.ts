import { z } from 'zod';
import { isIsoDate } from '@/lib/dates';

// Input validation for the My Day To Do and Reminders actions (P30). Kept
// out of planner-actions.ts because a 'use server' module may only export
// async functions.

export const TASK_KINDS = ['call', 'task', 'meeting', 'follow_up'] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export const TASK_KIND_LABEL: Record<TaskKind, string> = {
  call: 'Call',
  task: 'Task',
  meeting: 'Meeting',
  follow_up: 'Follow-up',
};

export const REMINDER_LEAD_MINUTES = [0, 5, 10, 15, 30, 60, 120, 1440] as const;

const isoDate = z.string().refine(isIsoDate, 'Pick a valid date.');
const optionalTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Pick a valid time.')
  .or(z.literal(''))
  .optional();
const title = z.string().trim().min(1, 'Add a title.').max(200, 'Keep it under 200 characters.');

export const createTaskSchema = z.object({
  title,
  kind: z.enum(TASK_KINDS).default('task'),
  dueOn: isoDate,
  dueTime: optionalTime,
  contactId: z.string().uuid().optional(),
});

export const toggleTaskSchema = z.object({
  id: z.string().uuid(),
  done: z.boolean(),
});

export const createReminderSchema = z.object({
  title,
  date: isoDate,
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Pick a valid time.'),
  leadMinutes: z.coerce
    .number()
    .refine((n) => (REMINDER_LEAD_MINUTES as readonly number[]).includes(n), 'Pick a lead time from the list.'),
  push: z.boolean().default(true),
});

export const idSchema = z.string().uuid();
