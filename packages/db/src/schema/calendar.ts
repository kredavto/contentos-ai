import {sql} from 'drizzle-orm';
import {pgTable,uuid,text,integer,timestamp,jsonb,boolean,unique,foreignKey,index,check} from 'drizzle-orm/pg-core';
import {brands,users} from './identity';
import {contentItems} from './content';
import {videoProjects} from './videos';
export const calendarEntries=pgTable('calendar_entries',{
  id:uuid('id').primaryKey().defaultRandom(),tenantId:uuid('tenant_id').notNull(),brandId:uuid('brand_id').notNull(),contentItemId:uuid('content_item_id').notNull(),videoProjectId:uuid('video_project_id'),
  plannedAt:timestamp('planned_at',{withTimezone:true}).notNull(),timeZone:text('time_zone').notNull(),platform:text('platform').notNull(),caption:text('caption').notNull(),hashtags:jsonb('hashtags').$type<string[]>().notNull().default([]),
  privacy:text('privacy',{enum:['PUBLIC','UNLISTED','PRIVATE']}).notNull().default('PUBLIC'),commentsEnabled:boolean('comments_enabled').notNull().default(true),publishingMode:text('publishing_mode',{enum:['MANUAL','APPROVAL']}).notNull().default('APPROVAL'),
  status:text('status',{enum:['PLANNED','CANCELLED']}).notNull().default('PLANNED'),revision:integer('revision').notNull().default(0),idempotencyKey:uuid('idempotency_key').notNull(),inputHash:text('input_hash').notNull(),createdBy:uuid('created_by').notNull().references(()=>users.id),
  createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),updatedAt:timestamp('updated_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[unique('calendar_tenant_id_uq').on(t.tenantId,t.id),unique('calendar_intent_uq').on(t.tenantId,t.idempotencyKey),unique('calendar_content_uq').on(t.contentItemId),index('calendar_window_idx').on(t.tenantId,t.brandId,t.plannedAt),
  foreignKey({columns:[t.tenantId,t.brandId],foreignColumns:[brands.tenantId,brands.id]}),foreignKey({columns:[t.tenantId,t.contentItemId],foreignColumns:[contentItems.tenantId,contentItems.id]}),foreignKey({columns:[t.tenantId,t.videoProjectId],foreignColumns:[videoProjects.tenantId,videoProjects.id]}),
  check('calendar_revision_valid',sql`${t.revision} >= 0`),check('calendar_status_valid',sql`${t.status} in ('PLANNED','CANCELLED')`),check('calendar_mode_valid',sql`${t.publishingMode} in ('MANUAL','APPROVAL')`),check('calendar_privacy_valid',sql`${t.privacy} in ('PUBLIC','UNLISTED','PRIVATE')`),
]);
