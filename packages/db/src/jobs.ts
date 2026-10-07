// Transactional job enqueue: jobs are written with the same transaction as the state change,
// so a report never exists without its follow-up job (and vice versa).

import type { PgBoss } from 'pg-boss';
import { JOB_NAMES } from '@rocan/core';
import type { Queryable } from './client';

export type Enqueue = (tx: Queryable, job: string, data: Record<string, unknown>) => Promise<void>;

export function pgBossEnqueue(boss: PgBoss): Enqueue {
  return async (tx, job, data) => {
    await boss.send(job, data, {
      db: {
        executeSql: async (text: string, values?: unknown[]) => ({
          rows: await tx.unsafe(text, (values ?? []) as never[]),
        }),
      },
    });
  };
}

export async function ensureQueues(boss: PgBoss): Promise<void> {
  for (const name of JOB_NAMES) await boss.createQueue(name);
}
