// @vitest-environment node
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as route from './route';

/**
 * Regression guard for the 405 described in route.ts: private.ping_app_route()
 * POSTs to every endpoint it pings, so a route that exports GET only is
 * unreachable from pg_cron and fails silently at the router, before any
 * handler or log. Both verbs must stay exported, and both must be authorized.
 */
describe('/api/cron/notifications verbs', () => {
  it('exports both GET and POST', () => {
    expect(typeof route.GET).toBe('function');
    expect(typeof route.POST).toBe('function');
  });

  it('serves POST with the same handler as GET, so the two cannot drift', () => {
    expect(route.POST).toBe(route.GET);
  });
});

describe('/api/cron/notifications authorization', () => {
  const original = process.env.CRON_SECRET;
  beforeEach(() => {
    process.env.CRON_SECRET = 'test-cron-secret';
  });
  afterEach(() => {
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
  });

  it('rejects a POST with no bearer token', async () => {
    const res = await route.POST(new Request('https://example.test/api/cron/notifications', { method: 'POST' }));
    expect(res.status).toBe(401);
  });

  it('rejects a POST with the wrong bearer token', async () => {
    const res = await route.POST(
      new Request('https://example.test/api/cron/notifications', {
        method: 'POST',
        headers: { authorization: 'Bearer nope' },
      })
    );
    expect(res.status).toBe(401);
  });
});
