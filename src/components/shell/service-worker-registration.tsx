'use client';

import { useEffect } from 'react';

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Registration failure (unsupported browser, blocked by privacy
        // settings) is non-fatal -- the app works fully online without it.
      });
    }
  }, []);

  return null;
}
