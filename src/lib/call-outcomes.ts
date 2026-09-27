import type { BadgeProps } from '@/components/ui/badge';

/** Single source of truth for how a call outcome maps to a Badge variant,
 * used anywhere an outcome shows up read-only (call rows, contact/notes
 * timelines) — mirrors the OUTCOMES list in log-form.tsx. */
export function outcomeBadgeVariant(outcome: string | null): NonNullable<BadgeProps['variant']> {
  switch (outcome) {
    case null:
      return 'warn';
    case 'appointment_set':
      return 'ok';
    case 'not_interested':
      return 'bad';
    case 'connected':
      return 'default';
    default:
      return 'neutral';
  }
}

/** A call saved from a dismissed post-call prompt has no outcome yet (P34). */
export const OUTCOME_NEEDED = 'Outcome needed';

/** Read-only label for a call outcome, e.g. "no answer" or "Outcome needed". */
export function outcomeLabel(outcome: string | null): string {
  return outcome ? outcome.replace('_', ' ') : OUTCOME_NEEDED;
}
