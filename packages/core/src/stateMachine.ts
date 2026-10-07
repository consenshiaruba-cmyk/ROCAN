// SPEC §8: the report lifecycle. Pure: no I/O, time comes from the caller's clock.
// The DB layer applies the returned patch, history row, audit row and effects in one
// transaction. Nothing else may change `report.status`.

import type { Clock } from '@rocan/clock';
import { REDACTION_FLAGS, type ActorType, type ReportFlag, type ReportStatus } from './enums';
import { TransitionError } from './errors';
import { JOBS } from './jobs';

export const PIPELINE_REJECT_REASONS = [
  'outside_aruba',
  'no_valid_image',
  'malware',
  'empty',
] as const;
export type PipelineRejectReason = (typeof PIPELINE_REJECT_REASONS)[number];

export type ReportEvent =
  | { type: 'submit' }
  | { type: 'ingest.start' }
  | { type: 'pipeline.reject'; reason: PipelineRejectReason }
  | { type: 'pipeline.done'; autoDispatch: boolean }
  | {
      type: 'moderator.approve';
      finalCategoryCode: string;
      severity: number;
      redactionsConfirmed: boolean;
    }
  | { type: 'moderator.reject'; reason: string }
  | { type: 'moderator.merge'; targetReportId: string }
  | { type: 'reporter.withdraw' }
  | { type: 'dispatch.all_primary_sent' }
  | { type: 'agency.ack' }
  | { type: 'agency.in_progress' }
  | { type: 'agency.resolve'; outcomeNote: string }
  | { type: 'agency.no_action'; reason: string }
  | { type: 'agency.decline'; reason: string }
  | { type: 'retention.expire' };

export type ReportEventType = ReportEvent['type'];

export const REPORT_EVENT_TYPES: readonly ReportEventType[] = [
  'submit',
  'ingest.start',
  'pipeline.reject',
  'pipeline.done',
  'moderator.approve',
  'moderator.reject',
  'moderator.merge',
  'reporter.withdraw',
  'dispatch.all_primary_sent',
  'agency.ack',
  'agency.in_progress',
  'agency.resolve',
  'agency.no_action',
  'agency.decline',
  'retention.expire',
];

/** `null` is the state before a report exists. */
export type FromStatus = ReportStatus | null;

export interface Actor {
  type: ActorType;
  id?: string | null;
}

export interface ReportSnapshot {
  id: string;
  status: FromStatus;
  flags: readonly ReportFlag[];
}

export type Effect =
  | { type: 'enqueue'; job: string; data: Record<string, unknown> }
  | { type: 'notify'; template: string; data: Record<string, unknown> };

export interface ReportPatch {
  status: ReportStatus;
  rejectionReason?: string;
  duplicateOf?: string;
  autoApproved?: boolean;
  finalCategoryCode?: string;
  severity?: number;
  moderatedBy?: string | null;
  moderatedAt?: Date;
  archivedAt?: Date;
}

export interface TransitionResult {
  from: FromStatus;
  to: ReportStatus;
  patch: ReportPatch;
  history: {
    fromStatus: FromStatus;
    toStatus: ReportStatus;
    actorType: ActorType;
    actorId: string | null;
    note: string | null;
    at: Date;
  };
  audit: {
    action: string;
    entity: 'report';
    entityId: string;
    actorType: ActorType;
    actorId: string | null;
    details: Record<string, unknown>;
    at: Date;
  };
  effects: Effect[];
}

/**
 * Which source states accept each event (SPEC §8.1). Events with more than one possible
 * target (pipeline.done) resolve the target in `resolveTarget`.
 */
export const TRANSITIONS: Readonly<Record<ReportEventType, readonly FromStatus[]>> = {
  submit: [null],
  'ingest.start': ['submitted'],
  'pipeline.reject': ['processing'],
  'pipeline.done': ['processing'],
  'moderator.approve': ['pending_review'],
  'moderator.reject': ['pending_review'],
  'moderator.merge': ['pending_review'],
  'reporter.withdraw': ['submitted', 'processing', 'pending_review'],
  'dispatch.all_primary_sent': ['approved'],
  'agency.ack': ['dispatched'],
  'agency.in_progress': ['dispatched', 'acknowledged'],
  'agency.resolve': ['acknowledged', 'in_progress'],
  'agency.no_action': ['acknowledged', 'in_progress'],
  'agency.decline': ['approved', 'dispatched', 'acknowledged', 'in_progress'],
  'retention.expire': ['rejected', 'merged', 'resolved', 'no_action'],
};

/** Who may trigger each event. Enforced here so no caller can skip it. */
const ALLOWED_ACTORS: Readonly<Record<ReportEventType, readonly ActorType[]>> = {
  submit: ['reporter'],
  'ingest.start': ['system'],
  'pipeline.reject': ['system'],
  'pipeline.done': ['system'],
  'moderator.approve': ['staff'],
  'moderator.reject': ['staff'],
  'moderator.merge': ['staff'],
  'reporter.withdraw': ['reporter'],
  'dispatch.all_primary_sent': ['system'],
  'agency.ack': ['staff', 'agency_link'],
  'agency.in_progress': ['staff'],
  'agency.resolve': ['staff'],
  'agency.no_action': ['staff'],
  'agency.decline': ['staff', 'agency_link'],
  'retention.expire': ['system'],
};

export function canTransition(from: FromStatus, event: ReportEventType): boolean {
  return TRANSITIONS[event].includes(from);
}

function fail(message: string): never {
  throw new TransitionError('guard_failed', message);
}

function requireText(value: string, field: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) fail(`${field} is required`);
  return trimmed;
}

export function transition(
  report: ReportSnapshot,
  event: ReportEvent,
  actor: Actor,
  clock: Clock,
): TransitionResult {
  const from = report.status;
  if (!canTransition(from, event.type)) {
    throw new TransitionError(
      'invalid_transition',
      `Event ${event.type} is not allowed in state ${from ?? '(new)'}`,
    );
  }
  if (!ALLOWED_ACTORS[event.type].includes(actor.type)) {
    fail(`Actor ${actor.type} may not trigger ${event.type}`);
  }

  const at = clock.now();
  const actorId = actor.id ?? null;
  const effects: Effect[] = [];
  let patch: ReportPatch;
  let note: string | null = null;

  switch (event.type) {
    case 'submit':
      patch = { status: 'submitted' };
      effects.push({ type: 'enqueue', job: JOBS.reportIngest, data: { reportId: report.id } });
      break;

    case 'ingest.start':
      patch = { status: 'processing' };
      break;

    case 'pipeline.reject':
      patch = { status: 'rejected', rejectionReason: event.reason };
      note = event.reason;
      break;

    case 'pipeline.done':
      if (event.autoDispatch) {
        patch = { status: 'approved', autoApproved: true };
        effects.push({ type: 'enqueue', job: JOBS.dispatchRender, data: { reportId: report.id } });
      } else {
        patch = { status: 'pending_review' };
      }
      break;

    case 'moderator.approve': {
      requireText(event.finalCategoryCode, 'finalCategoryCode');
      if (!Number.isInteger(event.severity) || event.severity < 1 || event.severity > 5) {
        fail('severity must be an integer 1–5');
      }
      const needsRedaction = report.flags.some((f) => REDACTION_FLAGS.includes(f));
      if (needsRedaction && !event.redactionsConfirmed) {
        fail('redactions must be confirmed for flagged media before approval');
      }
      patch = {
        status: 'approved',
        finalCategoryCode: event.finalCategoryCode,
        severity: event.severity,
        moderatedBy: actorId,
        moderatedAt: at,
      };
      effects.push({ type: 'enqueue', job: JOBS.dispatchRender, data: { reportId: report.id } });
      break;
    }

    case 'moderator.reject':
      note = requireText(event.reason, 'reason');
      patch = { status: 'rejected', rejectionReason: note, moderatedBy: actorId, moderatedAt: at };
      break;

    case 'moderator.merge':
      requireText(event.targetReportId, 'targetReportId');
      if (event.targetReportId === report.id) fail('a report cannot be merged into itself');
      patch = {
        status: 'merged',
        duplicateOf: event.targetReportId,
        moderatedBy: actorId,
        moderatedAt: at,
      };
      note = `merged into ${event.targetReportId}`;
      break;

    case 'reporter.withdraw':
      patch = { status: 'rejected', rejectionReason: 'withdrawn' };
      note = 'withdrawn';
      break;

    case 'dispatch.all_primary_sent':
      patch = { status: 'dispatched' };
      break;

    case 'agency.ack':
      patch = { status: 'acknowledged' };
      break;

    case 'agency.in_progress':
      patch = { status: 'in_progress' };
      break;

    case 'agency.resolve':
      note = requireText(event.outcomeNote, 'outcomeNote');
      patch = { status: 'resolved' };
      break;

    case 'agency.no_action':
      note = requireText(event.reason, 'reason');
      patch = { status: 'no_action' };
      break;

    case 'agency.decline':
      note = requireText(event.reason, 'reason');
      patch = { status: 'pending_review' };
      effects.push({
        type: 'notify',
        template: 'moderator.dispatch_declined',
        data: { reportId: report.id, reason: note },
      });
      break;

    case 'retention.expire':
      patch = { status: 'archived', archivedAt: at };
      effects.push({ type: 'enqueue', job: JOBS.retentionPurge, data: { reportId: report.id } });
      break;
  }

  return {
    from,
    to: patch.status,
    patch,
    history: { fromStatus: from, toStatus: patch.status, actorType: actor.type, actorId, note, at },
    audit: {
      action: `report.${event.type}`,
      entity: 'report',
      entityId: report.id,
      actorType: actor.type,
      actorId,
      details: { from, to: patch.status, ...(note ? { note } : {}) },
      at,
    },
    effects,
  };
}
