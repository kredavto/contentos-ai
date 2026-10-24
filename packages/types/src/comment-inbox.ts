import {z} from 'zod';
export const commentStatusSchema=z.enum(['NEW','NEEDS_HUMAN','RESOLVED']);
export const commentListSchema=z.object({
 status:commentStatusSchema.optional(),parentId:z.uuid().optional(),
 afterCreatedAt:z.iso.datetime().optional(),afterId:z.uuid().optional(),
}).strict().refine(value=>(value.afterCreatedAt===undefined)===(value.afterId===undefined),'Incomplete cursor');
export type CommentListInput=z.infer<typeof commentListSchema>;
export const commentTriageSchema=z.object({revision:z.number().int().nonnegative(),contentRevision:z.number().int().nonnegative(),status:commentStatusSchema}).strict();
export type CommentTriageInput=z.infer<typeof commentTriageSchema>;
