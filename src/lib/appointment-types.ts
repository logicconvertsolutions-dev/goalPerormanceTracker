// Picklist for appointments.appt_type. The column itself stays free `text`
// (not a Postgres enum) so pre-picklist data -- hand-typed or imported free
// text like "Solutions Presented" -- keeps rendering as-is; apptTypeLabel()
// below falls back to the raw value for anything outside this list instead
// of rejecting it.
export const APPT_TYPES = [
  { value: 'marketing_presentation', label: 'Marketing Presentation' },
  { value: 'solutions_presentation', label: 'Solutions Presentation' },
  { value: 'application', label: 'Application' },
  { value: 'follow_up', label: 'Follow Up' },
  { value: 'other', label: 'Other' },
] as const;

const APPT_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  APPT_TYPES.map((t) => [t.value, t.label])
);

export function apptTypeLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return APPT_TYPE_LABELS[value] ?? value;
}
