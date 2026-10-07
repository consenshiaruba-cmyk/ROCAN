import { loadEnv } from '@rocan/config';

/** Next.js would keep the process alive and answer 500s, so exit explicitly. */
export function assertBootConfig(): void {
  try {
    loadEnv();
  } catch (err) {
    console.error(`[web] refusing to start: ${(err as Error).message}`);
    process.exit(1);
  }
}
