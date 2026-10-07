// Next.js dev compiles each route on first request and then reloads open pages, which
// destroys the page a test is driving. Request every route once before the tests run.
import type { FullConfig } from '@playwright/test';

const PAGES = [
  '/',
  '/report',
  '/report/done',
  '/track',
  '/about',
  '/privacy',
  '/manifest.webmanifest',
  '/api/v1/meta',
];
const POSTS = ['/api/v1/uploads', '/api/v1/reports', '/api/v1/track', '/api/v1/track/withdraw'];

export default async function globalSetup(config: FullConfig): Promise<void> {
  const base = config.projects[0]?.use.baseURL ?? 'http://localhost:3000';
  for (const path of PAGES) await fetch(`${base}${path}`).then((r) => r.arrayBuffer());
  // Invalid bodies: compiles the handlers without creating anything.
  for (const path of POSTS) {
    await fetch(`${base}${path}`, {
      method: 'POST',
      body: '{}',
      headers: { 'content-type': 'application/json' },
    }).then((r) => r.arrayBuffer());
  }
  await fetch(`${base}/api/v1/uploads/00000000-0000-4000-8000-000000000000/1`, {
    method: 'PUT',
    body: 'x',
  });
}
