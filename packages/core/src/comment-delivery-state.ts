/** A persisted attempt must never become dispatchable again after a crash. */
export type CommentDeliveryState = 'QUEUED' | 'ATTEMPTED' | 'REJECTED' | 'RECONCILIATION_REQUIRED' | 'SUCCEEDED';
export type CommentDeliveryEvent = 'PREFLIGHT_DENIED' | 'ATTEMPT_RECORDED' | 'DEFINITIVE_REJECTION' | 'RECEIPT_CONFIRMED' | 'OUTCOME_UNKNOWN' | 'LEASE_EXPIRED';

/** Callers must persist transitions atomically and fence them with the attempt ID.
 * RECEIPT_CONFIRMED requires a validated receipt bound to that recorded attempt;
 * a missing remote comment or matching text alone is never confirmation.
 */
export function transitionCommentDelivery(state: CommentDeliveryState, event: CommentDeliveryEvent): CommentDeliveryState {
  if (state === 'QUEUED') {
    if (event === 'PREFLIGHT_DENIED') return 'REJECTED';
    if (event === 'ATTEMPT_RECORDED') return 'ATTEMPTED';
  }
  if (state === 'ATTEMPTED') {
    if (event === 'DEFINITIVE_REJECTION') return 'REJECTED';
    if (event === 'RECEIPT_CONFIRMED') return 'SUCCEEDED';
    if (event === 'OUTCOME_UNKNOWN' || event === 'LEASE_EXPIRED') return 'RECONCILIATION_REQUIRED';
  }
  if (state === 'RECONCILIATION_REQUIRED' && event === 'RECEIPT_CONFIRMED') return 'SUCCEEDED';
  throw new Error('INVALID_COMMENT_DELIVERY_TRANSITION');
}
