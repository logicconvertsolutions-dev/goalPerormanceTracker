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

export const LEADER_NAV: NavItem = { href: '/team', label: 'Team' };
