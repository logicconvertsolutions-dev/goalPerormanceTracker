import { Phone, CalendarCheck, HandCoins, UserPlus, type LucideIcon } from 'lucide-react';
import { chartColor } from '@/lib/chart-colors';

export type ActivityKind = 'call' | 'appointment' | 'sale' | 'recruiting';

/** Single source of truth for the icon + label + color representing each
 * activity type, used anywhere calls/appointments/sales/recruiting show up
 * side by side (log tabs, the activity logs hub, My Day's recent activity
 * list) — one color per kind so icons and active-tab highlighting agree.
 * `tint` is the same hue at 10% for the soft background behind an icon/tab;
 * both are theme-aware CSS colours (see lib/chart-colors.ts). */
export const ACTIVITY_META: Record<ActivityKind, { label: string; icon: LucideIcon; color: string; tint: string }> = {
  call: { label: 'Call', icon: Phone, color: chartColor('blue'), tint: chartColor('blue', 0.1) },
  appointment: {
    label: 'Appointment',
    icon: CalendarCheck,
    color: chartColor('violet'),
    tint: chartColor('violet', 0.1),
  },
  sale: { label: 'Sale', icon: HandCoins, color: chartColor('green'), tint: chartColor('green', 0.1) },
  recruiting: { label: 'Recruiting', icon: UserPlus, color: chartColor('orange'), tint: chartColor('orange', 0.1) },
};
