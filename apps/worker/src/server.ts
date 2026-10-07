// Minimal health endpoint for the worker process (no framework, no request logging).

import { createServer, type Server } from 'node:http';
import { readiness, type Check } from '@rocan/health';

export function startHealthServer(port: number, checks: () => Record<string, Check>): Server {
  const server = createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    res.setHeader('cache-control', 'no-store');
    if (req.url === '/healthz') {
      res.end(JSON.stringify({ status: 'ok', service: 'worker' }));
      return;
    }
    if (req.url === '/readyz') {
      const r = await readiness(checks());
      res.statusCode = r.status === 'ready' ? 200 : 503;
      res.end(JSON.stringify(r));
      return;
    }
    res.statusCode = 404;
    res.end('{"error":"not_found"}');
  });
  server.listen(port);
  return server;
}
