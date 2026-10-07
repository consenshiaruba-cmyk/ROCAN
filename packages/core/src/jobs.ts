// pg-boss queue names (SPEC §9). Created by the worker and web at startup.
export const JOBS = {
  reportIngest: 'report.ingest',
  dispatchRender: 'dispatch.render',
  retentionPurge: 'retention.purge',
  notify: 'notify',
} as const;
export const JOB_NAMES: readonly string[] = Object.values(JOBS);
