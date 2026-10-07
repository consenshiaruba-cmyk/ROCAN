// Runs once when the server boots. Fails fast on bad configuration, including
// MOCK_MODE=1 in production (SPEC Appendix A). The check lives in a Node-only module.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { assertBootConfig } = await import('./lib/boot');
    assertBootConfig();
  }
}
