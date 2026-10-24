import {sql} from 'drizzle-orm';
import {pgTable,uuid,text,integer,boolean,timestamp,unique,foreignKey,check} from 'drizzle-orm/pg-core';
import {videoProjects} from './videos';
import {libraryMedia} from './library-media';

export const videoBookends=pgTable('video_bookends',{
  id:uuid('id').primaryKey().defaultRandom(),tenantId:uuid('tenant_id').notNull(),projectId:uuid('project_id').notNull(),
  slot:text('slot').$type<'intro'|'outro'>().notNull(),assetId:uuid('asset_id').notNull(),
  sourceStartMs:integer('source_start_ms').notNull(),durationMs:integer('duration_ms').notNull(),approved:boolean('approved').notNull(),
  createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[
  unique('video_bookends_project_slot_uq').on(t.tenantId,t.projectId,t.slot),
  foreignKey({columns:[t.tenantId,t.projectId],foreignColumns:[videoProjects.tenantId,videoProjects.id]}),
  foreignKey({columns:[t.tenantId,t.assetId],foreignColumns:[libraryMedia.tenantId,libraryMedia.id]}),
  check('video_bookends_slot_valid',sql`${t.slot} in ('intro','outro')`),
  check('video_bookends_approved',sql`${t.approved} = true`),
  check('video_bookends_timing_valid',sql`${t.sourceStartMs} >= 0 and ${t.durationMs} between 100 and 30000 and ${t.sourceStartMs} + ${t.durationMs} <= 180000`),
]);
