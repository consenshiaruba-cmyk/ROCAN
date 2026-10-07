// Report persistence. Every status change goes through core `transition()` and is written
// together with its history row, audit row and jobs (CLAUDE.md non-negotiable).

import { randomUUID } from 'node:crypto';
import {
  generatePublicCode,
  transition,
  type Actor,
  type CreateReportParsed,
  type RandomInt,
  type ReportEvent,
  type ReportFlag,
  type ReportStatus,
  type TransitionResult,
} from '@rocan/core';
import type { Clock } from '@rocan/clock';
import { appendAudit } from './audit';
import type { Queryable, Sql } from './client';
import type { Enqueue } from './jobs';

async function applyResult(
  tx: Queryable,
  result: TransitionResult,
  enqueue: Enqueue,
): Promise<void> {
  const h = result.history;
  await tx`
    INSERT INTO report_status_history (report_id, from_status, to_status, actor_type, actor_id, note, at)
    VALUES (${result.audit.entityId}, ${h.fromStatus}, ${h.toStatus}, ${h.actorType}, ${h.actorId},
            ${h.note}, ${h.at.toISOString()})`;
  await appendAudit(tx, result.audit);
  for (const effect of result.effects) {
    if (effect.type === 'enqueue') await enqueue(tx, effect.job, effect.data);
    else await enqueue(tx, 'notify', { template: effect.template, ...effect.data });
  }
}

export interface CreateReportDeps {
  sql: Sql;
  clock: Clock;
  enqueue: Enqueue;
  randomInt: RandomInt;
  /** argon2id hash of the follow-up secret (PHC string). */
  secretHash: string;
}

export type CreateReportResult =
  | { created: true; reportId: string; publicCode: string }
  | { created: false; reportId: string; publicCode: string };

/** SPEC §5.3: idempotent on `idempotency_key`. */
export async function createReport(
  input: CreateReportParsed,
  deps: CreateReportDeps,
): Promise<CreateReportResult> {
  const { sql, clock } = deps;
  const existing = await findByIdempotencyKey(sql, input.idempotency_key);
  if (existing) return { created: false, ...existing };

  for (let attempt = 0; attempt < 5; attempt++) {
    const publicCode = generatePublicCode(deps.randomInt);
    const reportId = randomUUID();
    try {
      return await sql.begin(async (tx) => {
        const result = transition(
          { id: reportId, status: null, flags: [] },
          { type: 'submit' },
          { type: 'reporter' },
          clock,
        );
        const now = result.history.at;
        const inserted = await tx`
          INSERT INTO report (
            id, public_code, follow_up_token_hash, idempotency_key, status,
            client_created_at, received_at, submitted_offline, ui_language, reporter_category_id,
            description, observed_at, is_ongoing, location, location_accuracy_m, location_source,
            upload_id, photo_count, created_at, updated_at)
          VALUES (
            ${reportId}, ${publicCode}, ${Buffer.from(deps.secretHash)}, ${input.idempotency_key},
            ${result.to}, ${input.client_created_at}, ${now.toISOString()}, ${input.offline},
            ${input.ui_language},
            (SELECT id FROM category WHERE code = ${input.category_code ?? null}),
            ${input.description?.trim() || null}, ${input.observed_at ?? null}, ${input.is_ongoing ?? null},
            ST_SetSRID(ST_MakePoint(${input.location.lon}, ${input.location.lat}), 4326),
            ${input.location_accuracy_m == null ? null : String(input.location_accuracy_m)},
            ${input.location_source}, ${input.upload_id}, ${input.photo_count}, ${now.toISOString()},
            ${now.toISOString()})
          ON CONFLICT (idempotency_key) DO NOTHING
          RETURNING id`;
        if (inserted.length === 0) {
          // Lost a race with a concurrent retry of the same submission.
          const winner = await findByIdempotencyKey(tx, input.idempotency_key);
          if (!winner) throw new Error('idempotency conflict without a row');
          return { created: false as const, ...winner };
        }
        await applyResult(tx, result, deps.enqueue);
        return { created: true as const, reportId, publicCode };
      });
    } catch (err) {
      const pgErr = err as { code?: string; constraint_name?: string };
      if (pgErr.code === '23505' && pgErr.constraint_name === 'report_public_code_unique') continue;
      if (pgErr.code === '23505' && pgErr.constraint_name === 'report_public_code_key') continue;
      throw err;
    }
  }
  throw new Error('could not allocate a unique public code');
}

async function findByIdempotencyKey(
  sql: Queryable,
  key: string,
): Promise<{ reportId: string; publicCode: string } | null> {
  const [row] = await sql<{ id: string; public_code: string }[]>`
    SELECT id, public_code FROM report WHERE idempotency_key = ${key}`;
  return row ? { reportId: row.id, publicCode: row.public_code } : null;
}

export interface TrackingView {
  reportId: string;
  publicCode: string;
  status: ReportStatus;
  secretHash: string;
  history: { status: ReportStatus; at: Date }[];
  messages: { body: string; at: Date }[];
}

export async function findForTracking(sql: Sql, publicCode: string): Promise<TrackingView | null> {
  const [r] = await sql<
    { id: string; public_code: string; status: ReportStatus; follow_up_token_hash: Buffer }[]
  >`SELECT id, public_code, status, follow_up_token_hash FROM report WHERE public_code = ${publicCode}`;
  if (!r) return null;
  const history = await sql<{ to_status: ReportStatus; at: Date }[]>`
    SELECT to_status, at FROM report_status_history WHERE report_id = ${r.id} ORDER BY at, id`;
  const messages = await sql<{ body: string; at: Date }[]>`
    SELECT body, at FROM report_message WHERE report_id = ${r.id} AND direction = 'to_reporter'
    ORDER BY at, id`;
  return {
    reportId: r.id,
    publicCode: r.public_code,
    status: r.status,
    secretHash: r.follow_up_token_hash.toString('utf8'),
    history: history.map((h) => ({ status: h.to_status, at: h.at })),
    messages: messages.map((m) => ({ body: m.body, at: m.at })),
  };
}

export interface TransitionDeps {
  sql: Sql;
  clock: Clock;
  enqueue: Enqueue;
}

/** Load, transition and persist one report atomically (row lock against concurrent changes). */
export async function transitionReport(
  reportId: string,
  event: ReportEvent,
  actor: Actor,
  deps: TransitionDeps,
): Promise<TransitionResult> {
  return deps.sql.begin(async (tx) => {
    const [row] = await tx<{ status: ReportStatus; flags: ReportFlag[] }[]>`
      SELECT status, flags FROM report WHERE id = ${reportId} FOR UPDATE`;
    if (!row) throw new Error(`report ${reportId} not found`);
    const result = transition(
      { id: reportId, status: row.status, flags: row.flags },
      event,
      actor,
      deps.clock,
    );
    const p = result.patch;
    await tx`
      UPDATE report SET
        status = ${p.status},
        rejection_reason = COALESCE(${p.rejectionReason ?? null}, rejection_reason),
        duplicate_of = COALESCE(${p.duplicateOf ?? null}::uuid, duplicate_of),
        auto_approved = COALESCE(${p.autoApproved ?? null}::boolean, auto_approved),
        final_category_id = COALESCE((SELECT id FROM category WHERE code = ${p.finalCategoryCode ?? null}), final_category_id),
        severity = COALESCE(${p.severity ?? null}::smallint, severity),
        moderated_by = COALESCE(${p.moderatedBy ?? null}::uuid, moderated_by),
        moderated_at = COALESCE(${p.moderatedAt?.toISOString() ?? null}::timestamptz, moderated_at),
        archived_at = COALESCE(${p.archivedAt?.toISOString() ?? null}::timestamptz, archived_at),
        updated_at = ${result.history.at.toISOString()}
      WHERE id = ${reportId}`;
    await applyResult(tx, result, deps.enqueue);
    return result;
  });
}
