import {
  CalendarDays,
  ListPlus,
  Users,
  LayoutDashboard,
  UsersRound,
  ListChecks,
  NotebookText,
  UserCheck,
  Building2,
  UserCog,
  ScrollText,
  Gauge,
  MessageSquareWarning,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const PRIMARY_NAV: NavItem[] = [
  { href: '/today', label: 'My Day', icon: CalendarDays },
  { href: '/logs', label: 'Activity Logs', icon: ListChecks },
  { href: '/contacts', label: 'Contacts', icon: Users },
  { href: '/dashboard', label: 'My Dashboard', icon: LayoutDashboard },
];

// Desktop rail only — the mobile tab bar has no room for a 5th/6th slot, so
// this stays reachable on mobile via the quick-link on /dashboard instead
// (and via the header/page-level "Log Activity" buttons everywhere else).
export const SECONDARY_NAV: NavItem[] = [
  { href: '/log', label: 'Log Activity', icon: ListPlus },
  { href: '/notes', label: 'Meeting Notes', icon: NotebookText },
  { href: '/clients', label: 'Clients', icon: UserCheck },
];

export const LEADER_NAV: NavItem = { href: '/team', label: 'My Team', icon: UsersRound };

// An admin isn't a member of any organization and doesn't log activity of
// their own (see docs/09-account-and-auth.md's admin screens) — none of
// PRIMARY_NAV/SECONDARY_NAV/LEADER_NAV applies to them. This entirely
// replaces those for an admin session instead of being appended.
export const ADMIN_NAV: NavItem[] = [
  { href: '/admin/orgs', label: 'Orgs', icon: Building2 },
  { href: '/admin/agents', label: 'Agents', icon: UserCog },
  { href: '/admin/audit', label: 'Audit', icon: ScrollText },
  { href: '/admin/pilot', label: 'Pilot', icon: Gauge },
  { href: '/admin/feedback', label: 'Feedback', icon: MessageSquareWarning },
];
