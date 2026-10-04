/**
 * Every page to sweep in both themes. Dynamic routes ([id]) need real rows,
 * so they're reached through the static pages that link to them instead.
 * Add a route here when you add a page.
 */
export const PUBLIC_ROUTES = ['/login', '/forgot-password', '/privacy', '/terms'];

export const AGENT_ROUTES = [
  '/today',
  '/today/due',
  '/today/reminders',
  '/today/tasks',
  '/logs',
  '/log',
  '/contacts',
  '/dashboard',
  '/appointments',
  '/appointments/new',
  '/sales',
  '/sales/new',
  '/recruiting',
  '/recruiting/new',
  '/notes',
  '/clients',
  '/import',
  '/feedback',
  '/help',
  '/profile',
  '/settings',
];

export const LEADER_ROUTES = [
  ...AGENT_ROUTES,
  '/team',
  '/team/members',
  '/team/invites',
  '/team/targets',
  '/team/organization',
  '/team/audit',
];

export const ADMIN_ROUTES = [
  '/admin/orgs',
  '/admin/agents',
  '/admin/reports',
  '/admin/audit',
  '/admin/pilot',
  '/admin/feedback',
  '/admin/announcements',
  '/help',
  '/profile',
  '/settings',
];

export type Role = 'agent' | 'leader' | 'admin';

export const ROLE_ROUTES: Record<Role, string[]> = {
  agent: AGENT_ROUTES,
  leader: LEADER_ROUTES,
  admin: ADMIN_ROUTES,
};
