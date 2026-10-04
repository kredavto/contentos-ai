import {sql} from 'drizzle-orm';
import {pgTable,uuid,text,integer,jsonb,timestamp,unique,foreignKey,index,check} from 'drizzle-orm/pg-core';
import {brands,users} from './identity';
import {jobs} from './generation';
import {scripts} from './content';
import {avatarLooks} from './avatars';
import {voiceProfiles} from './voices';
import type {VideoStage,VideoProcessingOptions,ProviderReference,AvatarJobInput} from '@contentos/types';
export const videoProjects=pgTable('video_projects',{
  id:uuid('id').primaryKey().defaultRandom(),tenantId:uuid('tenant_id').notNull(),brandId:uuid('brand_id').notNull(),jobId:uuid('job_id').notNull(),
  scriptId:uuid('script_id').notNull(),scriptVersion:integer('script_version').notNull(),lookId:uuid('look_id').notNull(),voiceId:uuid('voice_id').notNull(),
  scriptText:text('script_text').notNull(),title:text('title').notNull(),platform:text('platform').notNull(),plannedDuration:integer('planned_duration').notNull(),
  avatarReference:jsonb('avatar_reference').$type<ProviderReference>().notNull(),voiceReference:jsonb('voice_reference').$type<ProviderReference>().notNull(),consent:jsonb('consent').$type<Pick<AvatarJobInput,'subjectId'|'requirements'>>().notNull(),
  options:jsonb('options').$type<VideoProcessingOptions>().notNull(),maxDurationSeconds:integer('max_duration_seconds').notNull(),stage:text('stage').$type<VideoStage>().notNull().default('VIDEO_REQUESTED'),stageRevision:integer('stage_revision').notNull().default(0),
  provider:text('provider').notNull(),reference:jsonb('reference').$type<ProviderReference>(),firstSubmittedAt:timestamp('first_submitted_at',{withTimezone:true}),mutationState:text('mutation_state',{enum:['NONE','STARTED','UNKNOWN','ACCEPTED','REJECTED']}).notNull().default('NONE'),
  originalKey:text('original_key').notNull(),finalKey:text('final_key').notNull(),coverKey:text('cover_key').notNull(),durationMs:integer('duration_ms'),finalBytes:integer('final_bytes'),
  approvedBy:uuid('approved_by').references(()=>users.id),approvedAt:timestamp('approved_at',{withTimezone:true}),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[unique('video_tenant_id_uq').on(t.tenantId,t.id),unique('video_job_uq').on(t.jobId),index('video_brand_idx').on(t.tenantId,t.brandId),
  foreignKey({columns:[t.tenantId,t.brandId],foreignColumns:[brands.tenantId,brands.id]}),foreignKey({columns:[t.tenantId,t.jobId],foreignColumns:[jobs.tenantId,jobs.id]}),foreignKey({columns:[t.tenantId,t.scriptId],foreignColumns:[scripts.tenantId,scripts.id]}),foreignKey({columns:[t.tenantId,t.lookId],foreignColumns:[avatarLooks.tenantId,avatarLooks.id]}),foreignKey({columns:[t.tenantId,t.voiceId],foreignColumns:[voiceProfiles.tenantId,voiceProfiles.id]}),
  check('video_stage_valid',sql`${t.stage} in ('VIDEO_REQUESTED','VOICE_PREPARING','AVATAR_RENDERING','POST_PROCESSING','CAPTIONS_GENERATING','BROLL_PROCESSING','COVER_GENERATING','QC','READY','FAILED')`),check('video_budget_valid',sql`${t.maxDurationSeconds} between 1 and 180`),check('video_mutation_valid',sql`${t.mutationState} in ('NONE','STARTED','UNKNOWN','ACCEPTED','REJECTED')`),
]);
export const videoTransitions=pgTable('video_transitions',{
  id:uuid('id').primaryKey().defaultRandom(),tenantId:uuid('tenant_id').notNull(),projectId:uuid('project_id').notNull(),revision:integer('revision').notNull(),fromStage:text('from_stage').$type<VideoStage>(),toStage:text('to_stage').$type<VideoStage>().notNull(),details:jsonb('details').$type<Record<string,unknown>>().notNull().default({}),correlationId:uuid('correlation_id').notNull(),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[unique('video_transition_revision_uq').on(t.projectId,t.revision),foreignKey({columns:[t.tenantId,t.projectId],foreignColumns:[videoProjects.tenantId,videoProjects.id]})]);
