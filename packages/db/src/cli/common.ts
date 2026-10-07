import { createDb } from '../client';

export const DEFAULT_DATABASE_URL = 'postgres://rocan:rocan@localhost:5432/rocan';

export function cliUrl(): string {
  return process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
}

export function cliDb() {
  return createDb(cliUrl(), { max: 1 });
}

export function isMockMode(): boolean {
  const v = process.env.MOCK_MODE;
  const mock = v === '1' || v === 'true';
  if (mock && process.env.NODE_ENV === 'production') {
    throw new Error('MOCK_MODE=1 is not allowed when NODE_ENV=production');
  }
  return mock;
}

export async function main(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  }
}
