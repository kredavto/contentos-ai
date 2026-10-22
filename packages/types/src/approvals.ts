import {z} from 'zod';
const scriptApprovalRequestSchema=z.object({scriptId:z.uuid(),version:z.number().int().positive(),requestedFrom:z.uuid(),comment:z.string().trim().max(2000).default(''),idempotencyKey:z.uuid()}).strict();
const postApprovalRequestSchema=scriptApprovalRequestSchema.omit({scriptId:true}).extend({postId:z.uuid()}).strict();
const carouselApprovalRequestSchema=scriptApprovalRequestSchema.omit({scriptId:true}).extend({carouselId:z.uuid(),lifecycleRevision:z.number().int().nonnegative()}).strict();
export const approvalRequestSchema=z.union([scriptApprovalRequestSchema,postApprovalRequestSchema,carouselApprovalRequestSchema]);
export const approvalDecisionSchema=z.object({status:z.enum(['APPROVED','REJECTED','CHANGES_REQUESTED','CANCELLED']),comment:z.string().trim().max(2000).default('')}).strict().refine(value=>!['REJECTED','CHANGES_REQUESTED'].includes(value.status)||value.comment.length>0,'Comment required');
export type ApprovalRequest=z.infer<typeof approvalRequestSchema>;
export type ApprovalDecision=z.infer<typeof approvalDecisionSchema>;
