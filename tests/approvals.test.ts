import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {approvalRequestSchema,approvalDecisionSchema} from '../packages/types/src/approvals';
it('requires an immutable version, assignee and bounded comments',()=>{
  const input={scriptId:randomUUID(),version:1,requestedFrom:randomUUID(),idempotencyKey:randomUUID()};expect(approvalRequestSchema.parse(input).comment).toBe('');
  for(const raw of [{...input,version:0},{...input,requestedFrom:'bad'},{...input,comment:'x'.repeat(2001)},{...input,status:'APPROVED'}])expect(approvalRequestSchema.safeParse(raw).success).toBe(false);
});
it('requires reasons for rejection and changes and denies unknown decisions',()=>{
  for(const status of ['REJECTED','CHANGES_REQUESTED']){expect(approvalDecisionSchema.safeParse({status}).success).toBe(false);expect(approvalDecisionSchema.parse({status,comment:'  Reason  '}).comment).toBe('Reason');}
  expect(approvalDecisionSchema.safeParse({status:'PENDING'}).success).toBe(false);
});
it('accepts one explicit text target and requires carousel lifecycle fencing',()=>{
  const common={version:1,requestedFrom:randomUUID(),idempotencyKey:randomUUID()};
  expect(approvalRequestSchema.safeParse({...common,postId:randomUUID()}).success).toBe(true);
  expect(approvalRequestSchema.safeParse({...common,carouselId:randomUUID(),lifecycleRevision:0}).success).toBe(true);
  for(const target of [{postId:randomUUID(),scriptId:randomUUID()},{carouselId:randomUUID()},{carouselId:randomUUID(),lifecycleRevision:-1},{postId:randomUUID(),lifecycleRevision:0}])expect(approvalRequestSchema.safeParse({...common,...target}).success).toBe(false);
});
it('binds an image to its sole generated version and rejects mixed targets or client hashes',()=>{
  const input={imageId:randomUUID(),version:1,requestedFrom:randomUUID(),idempotencyKey:randomUUID()};expect(approvalRequestSchema.safeParse(input).success).toBe(true);
  for(const raw of [{...input,version:2},{...input,postId:randomUUID()},{...input,mediaHash:'a'.repeat(64)},{...input,lifecycleRevision:0}])expect(approvalRequestSchema.safeParse(raw).success).toBe(false);
});
