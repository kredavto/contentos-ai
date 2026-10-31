import {expect, it} from 'vitest';
import {transitionCommentDelivery, type CommentDeliveryEvent, type CommentDeliveryState} from '../packages/core/src/comment-delivery-state';

it('separates preflight denial from a recorded remote attempt', () => {
  expect(transitionCommentDelivery('QUEUED', 'PREFLIGHT_DENIED')).toBe('REJECTED');
  expect(() => transitionCommentDelivery('QUEUED', 'RECEIPT_CONFIRMED')).toThrow();
  expect(transitionCommentDelivery('QUEUED', 'ATTEMPT_RECORDED')).toBe('ATTEMPTED');
  expect(transitionCommentDelivery('ATTEMPTED', 'DEFINITIVE_REJECTION')).toBe('REJECTED');
});

it('requires reconciliation after a lost response or worker restart and forbids another attempt', () => {
  for (const event of ['OUTCOME_UNKNOWN', 'LEASE_EXPIRED'] as const) {
    const state = transitionCommentDelivery('ATTEMPTED', event);
    expect(state).toBe('RECONCILIATION_REQUIRED');
    for (const forbidden of ['ATTEMPT_RECORDED', 'PREFLIGHT_DENIED', 'DEFINITIVE_REJECTION'] as const)
      expect(() => transitionCommentDelivery(state, forbidden)).toThrow();
    expect(transitionCommentDelivery(state, 'RECEIPT_CONFIRMED')).toBe('SUCCEEDED');
  }
});

it('keeps confirmed and rejected deliveries terminal', () => {
  const events: CommentDeliveryEvent[] = ['PREFLIGHT_DENIED', 'ATTEMPT_RECORDED', 'DEFINITIVE_REJECTION', 'RECEIPT_CONFIRMED', 'OUTCOME_UNKNOWN', 'LEASE_EXPIRED'];
  for (const state of ['SUCCEEDED', 'REJECTED'] satisfies CommentDeliveryState[])
    for (const event of events) expect(() => transitionCommentDelivery(state, event)).toThrow();
  expect(transitionCommentDelivery('ATTEMPTED', 'RECEIPT_CONFIRMED')).toBe('SUCCEEDED');
});
