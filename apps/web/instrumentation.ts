// Runs once when the server boots. Fails fast on bad configuration, including
// MOCK_MODE=1 in production (SPEC Appendix A). Next.js would otherwise keep the
// process alive and answer 500s, so exit explicitly.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { loadEnv } = await import('@rocan/config');
  try {
    loadEnv();
  } catch (err) {
    console.error(`[web] refusing to start: ${(err as Error).message}`);
    process.exit(1);
  }
}
