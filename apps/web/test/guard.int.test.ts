// SPEC Appendix A: the built web app exits instead of serving when MOCK_MODE=1 in production.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const web = join(import.meta.dirname, '..');

describe('web production guard', () => {
  it('next start exits with code 1 when MOCK_MODE=1 and NODE_ENV=production', () => {
    if (!existsSync(join(web, '.next', 'BUILD_ID'))) {
      const build = spawnSync('pnpm', ['build'], { cwd: web, encoding: 'utf8', timeout: 240_000 });
      expect(build.status, build.stderr).toBe(0);
    }
    const r = spawnSync('pnpm', ['exec', 'next', 'start', '--port', '3997'], {
      cwd: web,
      env: { ...process.env, NODE_ENV: 'production', MOCK_MODE: '1' },
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/refusing to start: MOCK_MODE=1 is not allowed/);
  }, 300_000);
});
