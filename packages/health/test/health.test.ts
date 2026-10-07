import { createServer } from 'node:net';
import { afterAll, describe, expect, it } from 'vitest';
import { readiness, runCheck, smtpCheck } from '../src/index';

describe('health checks', () => {
  it('reports success, failure and timeout', async () => {
    expect((await runCheck('ok', async () => {})).ok).toBe(true);
    const failed = await runCheck('bad', async () => {
      throw new Error('boom');
    });
    expect(failed).toMatchObject({ ok: false, error: 'boom' });
    const slow = await runCheck('slow', () => new Promise((r) => setTimeout(r, 200)), 20);
    expect(slow.error).toMatch(/timeout/);
  });

  it('is ready only when every check passes', async () => {
    expect((await readiness({ a: async () => {} })).status).toBe('ready');
    expect(
      (await readiness({ a: async () => {}, b: async () => Promise.reject(new Error('x')) }))
        .status,
    ).toBe('not_ready');
  });

  const server = createServer((s) => s.write('220 fake ESMTP\r\n'));
  afterAll(() => server.close());

  it('smtpCheck accepts a 220 greeting and rejects a closed port', async () => {
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    await expect(smtpCheck(`smtp://127.0.0.1:${port}`)()).resolves.toBeUndefined();
    await expect(smtpCheck('smtp://127.0.0.1:1')()).rejects.toThrow();
  });
});
