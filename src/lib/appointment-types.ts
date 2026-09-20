// Picklist for appointments.appt_type. The column itself stays free `text`
// (not a Postgres enum) so pre-picklist data -- hand-typed or imported free
// text like "Solutions Presented" -- keeps rendering as-is; apptTypeLabel()
// below falls back to the raw value for anything outside this list instead
// of rejecting it.
//
// Sorted alphabetically by label -- this is a picklist, not a workflow
// order, so A-Z is the least-surprising presentation.
export const APPT_TYPES = [
  { value: 'application', label: 'Application Submitted' },
  { value: 'follow_up', label: 'Follow Up' },
  { value: 'marketing_presentation', label: 'Marketing Presentation' },
  { value: 'other', label: 'Other' },
  { value: 'solutions_presentation', label: 'Solutions Presentation' },
] as const;

const APPT_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  APPT_TYPES.map((t) => [t.value, t.label])
);

export function apptTypeLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return APPT_TYPE_LABELS[value] ?? value;
}

// Picklist for appointments.status. Shared between appointment-form.tsx
// (the full form) and appointment-row.tsx (the inline quick-status Select)
// so the two stay in sync.
export const APPT_STATUSES = [
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'held', label: 'Held' },
  { value: 'no_show', label: 'No-show' },
  { value: 'rescheduled', label: 'Rescheduled' },
  { value: 'scheduled', label: 'Scheduled' },
] as const;

// "Scheduled" used to be the default status for a brand-new appointment log.
// Since a call logged with outcome "Appointment set" now carries its own
// date/time (P23) and no longer creates an appointments row at all, nothing
// should let an agent pick "Scheduled" here going forward -- both selects
// below use this pruned list instead of APPT_STATUSES. Rows already sitting
// at 'scheduled' from before this change keep that value (each select adds
// it back in as an option only when it's the row's current status, so an
// old row still displays and edits correctly).
export const SELECTABLE_APPT_STATUSES = APPT_STATUSES.filter((s) => s.value !== 'scheduled');
