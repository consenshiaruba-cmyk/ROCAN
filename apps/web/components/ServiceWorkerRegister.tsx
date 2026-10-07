'use client';

import { useEffect } from 'react';

/** Registers the service worker (app shell; offline outbox arrives in Phase 3). */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
        // Not fatal: the app works without it.
      });
    }
  }, []);
  return null;
}
