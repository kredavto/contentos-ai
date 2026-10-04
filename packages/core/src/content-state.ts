import { DomainError, type ContentState } from '@contentos/types';
const transitions: Record<ContentState, readonly ContentState[]> = {
  IDEA: ['SCRIPT'], SCRIPT: ['APPROVED_SCRIPT'], APPROVED_SCRIPT: ['SCRIPT', 'GENERATING'],
  GENERATING: ['READY', 'FAILED'], READY: ['APPROVED'], APPROVED: ['READY', 'SCHEDULED'],
  SCHEDULED: ['APPROVED', 'PUBLISHING'], PUBLISHING: ['PUBLISHED', 'FAILED'],
  PUBLISHED: [], FAILED: ['SCRIPT', 'GENERATING', 'SCHEDULED'],
};
export function assertContentTransition(from: ContentState, to: ContentState): void {
  if (!transitions[from]?.includes(to)) throw new DomainError('CONFLICT', 409);
}
