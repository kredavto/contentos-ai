import {z} from 'zod';
import {DomainError,type ProviderReference} from './index';
import {youtubeMetadataSchema,type YouTubeMetadata} from './youtube';
export const youtubePublicationOptionsSchema=youtubeMetadataSchema.pick({categoryId:true,madeForKids:true,containsSyntheticMedia:true}).extend({uploadCover:z.boolean()}).strict();
export const publishingStates=['SCHEDULED','PREPARING','SUBMITTING','PUBLISHED','FAILED','CANCELLED','RECONCILIATION'] as const;
export type PublishingState=typeof publishingStates[number];
export const publishingApprovalSchema=z.object({calendarId:z.uuid(),revision:z.number().int().nonnegative(),connectionId:z.uuid(),idempotencyKey:z.uuid(),youtube:youtubePublicationOptionsSchema.optional()}).strict();
export type PublishingApproval=z.infer<typeof publishingApprovalSchema>;
export interface PublishingSnapshot {title:string;type:'POST'|'SHORT_VIDEO';caption:string;privacy:'PUBLIC'|'PRIVATE'|'UNLISTED';commentsEnabled:boolean;timeZone:string;videoProjectId:string|null;finalKey:string|null;videoRevision?:number;videoApprovedAt?:string;youtube?:{metadata:YouTubeMetadata;totalBytes:number;coverKey:string|null;coverRevision:number|null}}
export const telegramVideoByteLimit=50_000_000;
export function validateTelegramPublication(input:{type:string;caption:string;privacy:string;commentsEnabled:boolean},reference:ProviderReference){
  if(!['POST','SHORT_VIDEO'].includes(input.type)||input.privacy!==(reference.metadata.public===true?'PUBLIC':'PRIVATE')||input.commentsEnabled!==(reference.metadata.hasLinkedDiscussion===true))throw new DomainError('INVALID_INPUT');
  if(input.caption.length>(input.type==='POST'?4096:1024)||(input.type==='POST'&&!input.caption.trim()))throw new DomainError('INVALID_INPUT');
}
