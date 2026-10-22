import {z} from 'zod';
const scriptApprovalRequestSchema=z.object({scriptId:z.uuid(),version:z.number().int().positive(),requestedFrom:z.uuid(),comment:z.string().trim().max(2000).default(''),idempotencyKey:z.uuid()}).strict();
const postApprovalRequestSchema=scriptApprovalRequestSchema.omit({scriptId:true}).extend({postId:z.uuid()}).strict();
const carouselApprovalRequestSchema=scriptApprovalRequestSchema.omit({scriptId:true}).extend({carouselId:z.uuid(),lifecycleRevision:z.number().int().nonnegative()}).strict();
const imageApprovalRequestSchema=scriptApprovalRequestSchema.omit({scriptId:true}).extend({imageId:z.uuid(),version:z.literal(1)}).strict();
const videoApprovalRequestSchema=scriptApprovalRequestSchema.omit({scriptId:true}).extend({videoId:z.uuid(),coverRevision:z.number().int().nonnegative()}).strict();
export const approvalRequestSchema=z.union([scriptApprovalRequestSchema,postApprovalRequestSchema,carouselApprovalRequestSchema,imageApprovalRequestSchema,videoApprovalRequestSchema]);
export const approvalDecisionSchema=z.object({status:z.enum(['APPROVED','REJECTED','CHANGES_REQUESTED','CANCELLED']),comment:z.string().trim().max(2000).default('')}).strict().refine(value=>!['REJECTED','CHANGES_REQUESTED'].includes(value.status)||value.comment.length>0,'Comment required');
export type ApprovalRequest=z.infer<typeof approvalRequestSchema>;
export type ApprovalDecision=z.infer<typeof approvalDecisionSchema>;

export const approvalCommentSchema=z.object({body:z.string().trim().min(1).max(2000),idempotencyKey:z.uuid()}).strict();
export const approvalListSchema=z.object({cursor:z.uuid().optional(),status:z.enum(['ALL','PENDING','APPROVED','REJECTED','CHANGES_REQUESTED','CANCELLED']).default('ALL')}).strict();
