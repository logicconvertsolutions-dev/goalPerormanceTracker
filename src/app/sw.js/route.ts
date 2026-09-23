// Served at /sw.js via a Route Handler rather than a public/ file, since
// public/ is the untracked legacy prototype and off-limits without asking.
// Deliberately minimal: app-shell caching only, no Background Sync (no
// Safari/iOS support — the offline retry queue in src/lib/offline/ already
// covers the "log while offline, sync on reconnect" case at the app layer,
// which works on every browser).
const SW_SOURCE = `
const CACHE_NAME = 'performance-tracker-shell-v1';
const SHELL_URLS = ['/today'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

// Network-first for navigations (always prefer fresh data when online),
// falling back to the cached app shell only when the network is unreachable.
self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;

  event.respondWith(
    fetch(event.request).catch(() =>
      caches.match(event.request).then((cached) => cached || caches.match('/today'))
    )
  );
});

// Web push (P30). Payload is JSON from /api/cron/push/drain:
// { title, body, url, tag }. url is always an in-app path.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data ? event.data.text() : '' };
  }
  const url = typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/today';
  event.waitUntil(
    self.registration.showNotification(data.title || 'Kautis', {
      body: data.body || '',
      icon: '/icon',
      badge: '/icon',
      tag: data.tag || undefined,
      data: { url: url },
    })
  );
});

// Tapping a notification focuses an open Kautis tab (navigating it to the
// notification's page) or opens a new one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = (event.notification.data && event.notification.data.url) || '/today';
  const target = new URL(path, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
          return client.focus().then((c) => (c && 'navigate' in c ? c.navigate(target) : c));
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
`;

export async function GET() {
  return new Response(SW_SOURCE, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Service-Worker-Allowed': '/',
      'Cache-Control': 'no-cache',
    },
  });
}
