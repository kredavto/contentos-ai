import {z} from 'zod';
import {youtubeChannelIdSchema,youtubeVideoIdSchema,youtubeCommentIdSchema,youtubeCommentCursorSchema,type YouTubeComment} from '@contentos/types';
const date=z.iso.datetime({offset:true});
export const youtubeCommentSchema=z.object({id:youtubeCommentIdSchema,snippet:z.object({
 channelId:youtubeChannelIdSchema,authorChannelId:z.object({value:youtubeChannelIdSchema}).optional(),authorDisplayName:z.string().max(1000).optional(),
 textDisplay:z.string().max(10000),parentId:youtubeCommentIdSchema.optional(),publishedAt:date,updatedAt:date,
}).refine(row=>Date.parse(row.updatedAt)>=Date.parse(row.publishedAt))});
export const youtubeThreadPageSchema=z.object({nextPageToken:youtubeCommentCursorSchema.optional(),items:z.array(z.object({id:youtubeCommentIdSchema,snippet:z.object({channelId:youtubeChannelIdSchema,videoId:youtubeVideoIdSchema,topLevelComment:youtubeCommentSchema,totalReplyCount:z.number().int().nonnegative().max(2147483647),canReply:z.boolean(),isPublic:z.boolean()})})).max(20)});
export const youtubeReplyPageSchema=z.object({nextPageToken:youtubeCommentCursorSchema.optional(),items:z.array(youtubeCommentSchema).max(20)});
export function normalizedYouTubeComment(row:z.infer<typeof youtubeCommentSchema>):YouTubeComment{
 return {externalId:row.id,parentExternalId:row.snippet.parentId??null,authorExternalId:row.snippet.authorChannelId?.value??null,authorName:row.snippet.authorDisplayName??null,text:row.snippet.textDisplay,publishedAt:new Date(row.snippet.publishedAt).toISOString(),updatedAt:new Date(row.snippet.updatedAt).toISOString()};
}
