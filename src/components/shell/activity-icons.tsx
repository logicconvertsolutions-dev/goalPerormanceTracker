import { Phone, CalendarCheck, HandCoins, UserPlus, type LucideIcon } from 'lucide-react';
import { CHART_COLORS } from '@/lib/chart-colors';

export type ActivityKind = 'call' | 'appointment' | 'sale' | 'recruiting';

/** Single source of truth for the icon + label + color representing each
 * activity type, used anywhere calls/appointments/sales/recruiting show up
 * side by side (log tabs, the activity logs hub, My Day's recent activity
 * list) — one color per kind so icons and active-tab highlighting agree. */
export const ACTIVITY_META: Record<ActivityKind, { label: string; icon: LucideIcon; color: string }> = {
  call: { label: 'Call', icon: Phone, color: CHART_COLORS.blue },
  appointment: { label: 'Appointment', icon: CalendarCheck, color: CHART_COLORS.violet },
  sale: { label: 'Sale', icon: HandCoins, color: CHART_COLORS.green },
  recruiting: { label: 'Recruiting', icon: UserPlus, color: CHART_COLORS.orange },
};
