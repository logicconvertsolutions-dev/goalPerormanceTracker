import type { Role } from './routes';

/** Where auth.setup.ts saves each role's signed-in session (git-ignored). */
export const authFile = (role: Role) => `e2e/.auth/${role}.json`;
