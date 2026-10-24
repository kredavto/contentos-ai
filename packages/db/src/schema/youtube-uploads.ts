import {sql} from 'drizzle-orm';
import {pgTable,uuid,text,integer,jsonb,timestamp,unique,foreignKey,check} from 'drizzle-orm/pg-core';
import type {EncryptedCredential} from '@contentos/types';
import {publishingJobs} from './publishing';
export const youtubeUploads=pgTable('youtube_uploads',{
  id:uuid('id').primaryKey().defaultRandom(),tenantId:uuid('tenant_id').notNull(),jobId:uuid('job_id').notNull(),
  phase:text('phase').$type<'STARTING'|'UPLOADING'|'PROCESSING'|'THUMBNAIL'|'VERIFYING'|'COMPLETE'>().notNull().default('STARTING'),
  session:jsonb('session').$type<EncryptedCredential>(),sourceEtag:text('source_etag').notNull(),totalBytes:integer('total_bytes').notNull(),nextByte:integer('next_byte').notNull().default(0),channelId:text('channel_id').notNull(),videoId:text('video_id'),
  retryCount:integer('retry_count').notNull().default(0),revision:integer('revision').notNull().default(0),lastError:text('last_error'),
  createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),updatedAt:timestamp('updated_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[unique('youtube_upload_job_uq').on(t.jobId),unique('youtube_upload_tenant_id_uq').on(t.tenantId,t.id),
  foreignKey({columns:[t.tenantId,t.jobId],foreignColumns:[publishingJobs.tenantId,publishingJobs.id]}),
  check('youtube_upload_bounds',sql`${t.totalBytes} between 1 and 268435456 and ${t.nextByte} between 0 and ${t.totalBytes} and ${t.retryCount} between 0 and 8 and ${t.revision} >= 0`),
  check('youtube_upload_identity',sql`${t.channelId} ~ '^UC[A-Za-z0-9_-]{22}$' and ${t.sourceEtag} ~ '^"[A-Za-z0-9_-]{1,128}"$' and (${t.videoId} is null or ${t.videoId} ~ '^[A-Za-z0-9_-]{11}$')`),
  check('youtube_upload_phase',sql`(${t.phase}='STARTING' and ${t.session} is null and ${t.videoId} is null and ${t.nextByte}=0) or (${t.phase}='UPLOADING' and ${t.session} is not null and ${t.videoId} is null) or (${t.phase} in ('PROCESSING','THUMBNAIL','VERIFYING') and ${t.session} is not null and ${t.videoId} is not null and ${t.nextByte}=${t.totalBytes}) or (${t.phase}='COMPLETE' and ${t.session} is null and ${t.videoId} is not null and ${t.nextByte}=${t.totalBytes})`),
]);
