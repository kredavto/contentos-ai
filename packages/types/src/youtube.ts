import {z} from 'zod';
import type {OperationContext,ProviderReference} from './providers';

export const youtubeChannelIdSchema=z.string().regex(/^UC[A-Za-z0-9_-]{22}$/);
export const youtubeVideoIdSchema=z.string().regex(/^[A-Za-z0-9_-]{11}$/);
export const youtubePrivacySchema=z.enum(['PUBLIC','UNLISTED','PRIVATE']);
const text=(limit:number)=>z.string().max(limit).refine(value=>!/[<>]/u.test(value)&&Array.from(value).every(char=>char.charCodeAt(0)>=32||['\n','\r','\t'].includes(char)));
export const youtubeMetadataSchema=z.object({
  title:text(100).refine(value=>!!value.trim()),description:text(5000).refine(value=>new TextEncoder().encode(value).length<=5000),
  tags:z.array(text(100).min(1)).max(30).refine(tags=>tags.reduce((sum,tag)=>sum+tag.length+(tag.includes(' ')?2:0),Math.max(0,tags.length-1))<=500),
  categoryId:z.string().regex(/^[1-9][0-9]{0,9}$/),privacy:youtubePrivacySchema,
  madeForKids:z.boolean(),containsSyntheticMedia:z.boolean(),
}).strict();
export type YouTubeMetadata=z.infer<typeof youtubeMetadataSchema>;
export const oauthTokenSchema=z.string().min(1).max(8192).regex(/^[\x21-\x7e]+$/);
export const youtubeTokensSchema=z.object({accessToken:oauthTokenSchema,refreshToken:oauthTokenSchema,expiresAt:z.iso.datetime(),refreshExpiresAt:z.iso.datetime().nullable(),scopes:z.array(z.string().min(1).max(256)).min(1).max(32)}).strict();
export type YouTubeTokens=z.infer<typeof youtubeTokensSchema>;
export const youtubeConnectSchema=z.object({commentsAccess:z.boolean().default(false),connectionId:z.uuid().optional(),revision:z.number().int().nonnegative().optional()}).strict().refine(value=>(value.connectionId===undefined)===(value.revision===undefined));
export const youtubeCallbackSchema=z.object({state:z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),code:oauthTokenSchema.optional(),error:z.string().regex(/^[a-z_]{1,100}$/).optional()}).refine(value=>(value.code===undefined)!==(value.error===undefined));
export interface YouTubeVideo {
  reference:ProviderReference;channelId:string;privacy:z.infer<typeof youtubePrivacySchema>;
  state:'PROCESSING'|'READY'|'FAILED';failureCode:string|null;
}
export type YouTubeUploadResult={state:'UPLOADING';nextByte:number;retryAfterSeconds:number|null}|{state:'COMPLETE';video:YouTubeVideo}|{state:'EXPIRED'};
/** Each method makes one remote attempt. The worker persists the session before sending bytes. */
export interface YouTubePublishingProvider {
  startUpload(accessToken:string,metadata:YouTubeMetadata,totalBytes:number,context:OperationContext):Promise<string>;
  probeUpload(accessToken:string,session:string,totalBytes:number,channelId:string,context:OperationContext):Promise<YouTubeUploadResult>;
  upload(accessToken:string,session:string,input:{totalBytes:number;offset:number;bytes:Uint8Array;channelId:string},context:OperationContext):Promise<YouTubeUploadResult>;
  video(accessToken:string,videoId:string,channelId:string,context:OperationContext):Promise<YouTubeVideo|null>;
  thumbnail(accessToken:string,videoId:string,input:{bytes:Uint8Array;mimeType:'image/png'|'image/jpeg'},context:OperationContext):Promise<void>;
}
export interface YouTubeAuthorizationProvider {
  authorizationUrl(state:string,verifier:string,commentsAccess?:boolean):string;
  exchange(code:string,verifier:string,context:OperationContext):Promise<YouTubeTokens>;
  refresh(tokens:YouTubeTokens,context:OperationContext):Promise<YouTubeTokens>;
  revoke(refreshToken:string,context:OperationContext):Promise<void>;
  channel(accessToken:string,context:OperationContext):Promise<{reference:ProviderReference;name:string;username:string|null}>;
}

export interface YouTubeCatalogProvider {
  categories(accessToken:string,regionCode:string,context:OperationContext):Promise<Array<{id:string;title:string}>>;
}

/** Cumulative Data API counters; unavailable analytics are represented by null. */
export interface YouTubeStatisticsProvider {
  statistics(accessToken:string,videoId:string,channelId:string,context:OperationContext):Promise<{reference:ProviderReference;observedAt:string;metrics:import('./analytics').NormalizedMetrics}|null>;
}

/** Operator confirms only a remote identity already persisted by the upload worker. */
export const youtubeResolutionSchema=z.object({tenantId:z.uuid(),jobId:z.uuid(),expectedRevision:z.number().int().min(0).max(2147483646),ticket:z.string().trim().regex(/^[A-Za-z0-9_-]{3,80}$/),idempotencyKey:z.uuid()}).strict();
export type YouTubeResolutionInput=z.infer<typeof youtubeResolutionSchema>;

export const youtubeCommentsScope='https://www.googleapis.com/auth/youtube.force-ssl';
export const youtubeCommentIdSchema=z.string().regex(/^[A-Za-z0-9_.-]{1,256}$/);
export const youtubeCommentCursorSchema=z.string().min(1).max(4096).refine(value=>!/[\p{Cc}\p{White_Space}]/u.test(value));
export type YouTubeComment={externalId:string;parentExternalId:string|null;authorExternalId:string|null;authorName:string|null;text:string;publishedAt:string;updatedAt:string};
export type YouTubeCommentThread={externalId:string;comment:YouTubeComment;replyCount:number;canReply:boolean;isPublic:boolean};
export type YouTubeCommentPage<T>={reference:ProviderReference;observedAt:string;nextCursor:string|null;items:T[]};
export interface YouTubeCommentsProvider {
  commentThreads(accessToken:string,videoId:string,channelId:string,cursor:string|null,context:OperationContext):Promise<YouTubeCommentPage<YouTubeCommentThread>>;
  /** The caller must bind parentId to a previously verified publication/thread. */
  commentReplies(accessToken:string,parentId:string,channelId:string,cursor:string|null,context:OperationContext):Promise<YouTubeCommentPage<YouTubeComment>>;
}

export const youtubeCommentReplyInputSchema=z.object({parentId:youtubeCommentIdSchema,channelId:youtubeChannelIdSchema,text:z.string().max(2000).refine(value=>value.trim().length>0&&!value.includes('\u0000'))}).strict();
export type YouTubeCommentReplyInput=z.infer<typeof youtubeCommentReplyInputSchema>;
/** Separate write capability: callers must persist an attempt and validate approval/scopes before calling. */
export interface YouTubeCommentPublishingProvider {
  /** Read-only evidence lookup; null is not permission to resend an uncertain insert. */
  commentReplyReceipt(accessToken:string,externalId:string,value:YouTubeCommentReplyInput,context:OperationContext):Promise<{reference:ProviderReference;publishedAt:string}|null>;
 insertCommentReply(accessToken:string,value:YouTubeCommentReplyInput,context:OperationContext):Promise<{reference:ProviderReference;publishedAt:string}>;
}
