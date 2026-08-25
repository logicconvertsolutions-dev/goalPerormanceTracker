import { Phone, CalendarCheck, HandCoins, UserPlus, type LucideIcon } from 'lucide-react';

export type ActivityKind = 'call' | 'appointment' | 'sale' | 'recruiting';

/** Single source of truth for the icon + label representing each activity
 * type, used anywhere calls/appointments/sales/recruiting show up side by
 * side (log tabs, the activity logs hub, My Day's recent activity list). */
export const ACTIVITY_META: Record<ActivityKind, { label: string; icon: LucideIcon }> = {
  call: { label: 'Call', icon: Phone },
  appointment: { label: 'Appointment', icon: CalendarCheck },
  sale: { label: 'Sale', icon: HandCoins },
  recruiting: { label: 'Recruiting', icon: UserPlus },
};
