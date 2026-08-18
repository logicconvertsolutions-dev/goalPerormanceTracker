export interface NavItem {
  href: string;
  label: string;
}

export const PRIMARY_NAV: NavItem[] = [
  { href: '/today', label: 'Today' },
  { href: '/log', label: 'Log' },
  { href: '/contacts', label: 'Contacts' },
  { href: '/dashboard', label: 'Me' },
];

// Desktop rail only — the mobile tab bar has no room for a 5th/6th/7th slot,
// so these stay reachable on mobile via quick-links on /dashboard instead.
export const SECONDARY_NAV: NavItem[] = [
  { href: '/appointments', label: 'Appointments' },
  { href: '/sales', label: 'Sales' },
  { href: '/recruiting', label: 'Recruiting' },
];

export const LEADER_NAV: NavItem = { href: '/team', label: 'Team' };
