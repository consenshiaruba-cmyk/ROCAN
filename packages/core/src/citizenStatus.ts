// SPEC §8.2: what a reporter sees. Never reveals agencies, notes or other reports.
import type { ReportStatus } from './enums';

export const CITIZEN_STATUSES = [
  'received',
  'checking',
  'sent',
  'handling',
  'closed_action',
  'closed',
  'not_forwarded',
  'combined',
] as const;
export type CitizenStatus = (typeof CITIZEN_STATUSES)[number];

const MAP: Record<ReportStatus, CitizenStatus> = {
  submitted: 'received',
  processing: 'received',
  pending_review: 'checking',
  approved: 'sent',
  dispatched: 'sent',
  acknowledged: 'handling',
  in_progress: 'handling',
  resolved: 'closed_action',
  no_action: 'closed',
  rejected: 'not_forwarded',
  merged: 'combined',
  archived: 'closed',
};

export function citizenStatus(status: ReportStatus): CitizenStatus {
  return MAP[status];
}

/** A reporter may withdraw until a moderator has acted (SPEC §8.1). */
export function canReporterWithdraw(status: ReportStatus): boolean {
  return status === 'submitted' || status === 'processing' || status === 'pending_review';
}
