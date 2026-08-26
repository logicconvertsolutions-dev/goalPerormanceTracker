import {
  CalendarDays,
  ListPlus,
  Users,
  LayoutDashboard,
  UsersRound,
  ListChecks,
  NotebookText,
  UserCheck,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const PRIMARY_NAV: NavItem[] = [
  { href: '/today', label: 'My Day', icon: CalendarDays },
  { href: '/log', label: 'Log Activity', icon: ListPlus },
  { href: '/contacts', label: 'Contacts', icon: Users },
  { href: '/dashboard', label: 'My Dashboard', icon: LayoutDashboard },
];

// Desktop rail only — the mobile tab bar has no room for a 5th/6th slot, so
// this stays reachable on mobile via the quick-link on /dashboard instead.
export const SECONDARY_NAV: NavItem[] = [
  { href: '/logs', label: 'Activity Logs', icon: ListChecks },
  { href: '/notes', label: 'Meeting Notes', icon: NotebookText },
  { href: '/clients', label: 'Clients', icon: UserCheck },
];

export const LEADER_NAV: NavItem = { href: '/team', label: 'My Team', icon: UsersRound };
