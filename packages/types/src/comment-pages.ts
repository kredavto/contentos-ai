import {z} from 'zod';
import {youtubeChannelIdSchema,youtubeVideoIdSchema,youtubeCommentIdSchema,youtubeCommentCursorSchema} from './youtube';
const date=z.iso.datetime();
const text=(max:number)=>z.string().max(max).refine(value=>!value.includes('\u0000'),'Unsupported text character');
export const importedCommentSchema=z.object({
 externalId:youtubeCommentIdSchema,parentExternalId:youtubeCommentIdSchema.nullable(),authorExternalId:youtubeChannelIdSchema.nullable(),authorName:text(1000).nullable(),text:text(10000),publishedAt:date,updatedAt:date,
}).strict().refine(value=>Date.parse(value.updatedAt)>=Date.parse(value.publishedAt));
export type ImportedComment=z.infer<typeof importedCommentSchema>;
const reference=(kind:'comment-threads'|'comment-replies',externalId:z.ZodString)=>z.object({provider:z.literal('youtube'),internalId:z.uuid(),externalId,metadata:z.object({kind:z.literal(kind),channelId:youtubeChannelIdSchema}).strict()}).strict();
export const importedThreadPageSchema=z.object({
 reference:reference('comment-threads',youtubeVideoIdSchema),observedAt:date,nextCursor:youtubeCommentCursorSchema.nullable(),
 items:z.array(z.object({externalId:youtubeCommentIdSchema,comment:importedCommentSchema,replyCount:z.number().int().min(0).max(2147483647),canReply:z.boolean(),isPublic:z.boolean()}).strict()).max(20),
}).strict().refine(page=>page.items.every(row=>row.comment.parentExternalId===null)&&new Set(page.items.map(row=>row.externalId)).size===page.items.length&&new Set(page.items.map(row=>row.comment.externalId)).size===page.items.length);
export const importedReplyPageSchema=z.object({
 reference:reference('comment-replies',youtubeCommentIdSchema),observedAt:date,nextCursor:youtubeCommentCursorSchema.nullable(),items:z.array(importedCommentSchema).max(20),
}).strict().refine(page=>page.items.every(row=>row.parentExternalId===page.reference.externalId&&row.externalId!==page.reference.externalId)&&new Set(page.items.map(row=>row.externalId)).size===page.items.length);
export type ImportedThreadPage=z.infer<typeof importedThreadPageSchema>;
export type ImportedReplyPage=z.infer<typeof importedReplyPageSchema>;
