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
