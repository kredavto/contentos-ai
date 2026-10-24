import {z} from 'zod';
import {youtubeCommentCursorSchema} from './youtube';
export const commentStatusSchema=z.enum(['NEW','NEEDS_HUMAN','RESOLVED']);
export const commentListSchema=z.object({
 status:commentStatusSchema.optional(),parentId:z.uuid().optional(),
 afterCreatedAt:z.iso.datetime().optional(),afterId:z.uuid().optional(),
}).strict().refine(value=>(value.afterCreatedAt===undefined)===(value.afterId===undefined),'Incomplete cursor');
export type CommentListInput=z.infer<typeof commentListSchema>;
export const commentTriageSchema=z.object({revision:z.number().int().nonnegative(),contentRevision:z.number().int().nonnegative(),status:commentStatusSchema}).strict();
export type CommentTriageInput=z.infer<typeof commentTriageSchema>;

const cursor=youtubeCommentCursorSchema.nullable();
export const commentImportPositionSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('THREADS'),cursor}).strict(),
 z.object({kind:z.literal('REPLIES'),cursor,parentId:z.uuid(),pendingParentIds:z.array(z.uuid()).max(19),nextThreadCursor:cursor}).strict(),
]).refine(position=>position.kind==='THREADS'||(new Set([position.parentId,...position.pendingParentIds]).size===position.pendingParentIds.length+1));
export type CommentImportPosition=z.infer<typeof commentImportPositionSchema>;

export const commentImportRequestSchema=z.object({idempotencyKey:z.uuid()}).strict();
export const commentImportRevisionSchema=z.object({revision:z.number().int().nonnegative()}).strict();
