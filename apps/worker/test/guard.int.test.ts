// SPEC Appendix A: the processes refuse to start with MOCK_MODE=1 in production.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..', '..', '..');

function run(cmd: string, args: string[], cwd: string, env: Record<string, string>) {
  return spawnSync(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 60_000,
  });
}

describe('production guard', () => {
  it('worker exits when MOCK_MODE=1 and NODE_ENV=production', () => {
    const r = run('pnpm', ['exec', 'tsx', 'src/main.ts'], join(root, 'apps/worker'), {
      NODE_ENV: 'production',
      MOCK_MODE: '1',
      WORKER_PORT: '0',
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/MOCK_MODE=1 is not allowed/);
  });

  it('db:reset and dev:mock refuse to run in production', () => {
    const reset = run('pnpm', ['--silent', 'db:reset'], root, { NODE_ENV: 'production' });
    expect(reset.status).not.toBe(0);
    expect(reset.stderr + reset.stdout).toMatch(/disabled in production/);
    const dev = run('bash', ['scripts/dev-mock.sh'], root, { NODE_ENV: 'production' });
    expect(dev.status).toBe(1);
    expect(dev.stderr).toMatch(/refuses to run with NODE_ENV=production/);
  });
});
