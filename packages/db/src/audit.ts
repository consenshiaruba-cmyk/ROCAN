// SPEC §13.3: append-only, hash-chained audit log. Each row's hash covers the previous
// row's hash plus a canonical JSON of its own content, so any edit or deletion breaks the chain.

import { createHash } from 'node:crypto';
import type { ActorType } from '@rocan/core';
import type { Queryable, Sql } from './client';

export interface AuditEntry {
  at: Date;
  actorType: ActorType;
  actorId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  details: Record<string, unknown>;
}

/** JSON with sorted keys at every level, so the same content always hashes the same. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(',')}}`;
}

export function auditHash(prevHash: Buffer | null, entry: AuditEntry): Buffer {
  return createHash('sha256')
    .update(prevHash ?? Buffer.alloc(0))
    .update(canonicalJson({ ...entry, at: entry.at.toISOString() }))
    .digest();
}

/** Must run inside a transaction. The advisory lock serializes writers so the chain stays linear. */
export async function appendAudit(tx: Queryable, entry: AuditEntry): Promise<void> {
  await tx`SELECT pg_advisory_xact_lock(hashtext('rocan.audit_log'))`;
  const [last] = await tx<{ hash: Buffer }[]>`SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1`;
  const prev = last?.hash ?? null;
  const hash = auditHash(prev, entry);
  await tx`
    INSERT INTO audit_log (at, actor_type, actor_id, action, entity, entity_id, details, prev_hash, hash)
    VALUES (${entry.at.toISOString()}, ${entry.actorType}, ${entry.actorId}, ${entry.action}, ${entry.entity},
            ${entry.entityId}, ${tx.json(entry.details as never)}, ${prev}, ${hash})`;
}

/** Recompute the whole chain. Returns the id of the first broken row, or null when intact. */
export async function verifyAuditChain(sql: Sql): Promise<number | null> {
  const rows = await sql<
    {
      id: number;
      at: Date;
      actor_type: ActorType;
      actor_id: string | null;
      action: string;
      entity: string;
      entity_id: string | null;
      details: Record<string, unknown>;
      prev_hash: Buffer | null;
      hash: Buffer;
    }[]
  >`SELECT * FROM audit_log ORDER BY id`;
  let prev: Buffer | null = null;
  for (const r of rows) {
    const expected = auditHash(prev, {
      at: r.at,
      actorType: r.actor_type,
      actorId: r.actor_id,
      action: r.action,
      entity: r.entity,
      entityId: r.entity_id,
      details: r.details,
    });
    const prevMatches =
      prev === null ? r.prev_hash === null : !!r.prev_hash && prev.equals(r.prev_hash);
    if (!prevMatches || !expected.equals(r.hash)) return Number(r.id);
    prev = r.hash;
  }
  return null;
}
