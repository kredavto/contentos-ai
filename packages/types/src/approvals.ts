import {z} from 'zod';
export const approvalRequestSchema=z.object({scriptId:z.uuid(),version:z.number().int().positive(),requestedFrom:z.uuid(),comment:z.string().trim().max(2000).default(''),idempotencyKey:z.uuid()}).strict();
export const approvalDecisionSchema=z.object({status:z.enum(['APPROVED','REJECTED','CHANGES_REQUESTED','CANCELLED']),comment:z.string().trim().max(2000).default('')}).strict().refine(value=>!['REJECTED','CHANGES_REQUESTED'].includes(value.status)||value.comment.length>0,'Comment required');
export type ApprovalRequest=z.infer<typeof approvalRequestSchema>;
export type ApprovalDecision=z.infer<typeof approvalDecisionSchema>;
