import type { BadgeProps } from '@/components/ui/badge';

/** Single source of truth for how a call outcome maps to a Badge variant,
 * used anywhere an outcome shows up read-only (call rows, contact/notes
 * timelines) — mirrors the OUTCOMES list in log-form.tsx. */
export function outcomeBadgeVariant(outcome: string): NonNullable<BadgeProps['variant']> {
  switch (outcome) {
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
