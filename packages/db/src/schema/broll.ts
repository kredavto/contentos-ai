import {sql} from 'drizzle-orm';
import {pgTable,uuid,integer,text,boolean,timestamp,unique,foreignKey,check} from 'drizzle-orm/pg-core';
import {videoProjects} from './videos';
import {libraryMedia} from './library-media';

export const brollSegments=pgTable('broll_segments',{
  id:uuid('id').primaryKey().defaultRandom(),tenantId:uuid('tenant_id').notNull(),projectId:uuid('project_id').notNull(),assetId:uuid('asset_id').notNull(),
  fadeMs:integer('fade_ms').notNull().default(0),
  position:integer('position').notNull().default(0),
  startMs:integer('start_ms').notNull(),endMs:integer('end_ms').notNull(),sourceStartMs:integer('source_start_ms').notNull(),
  source:text('source').notNull().default('USER_MEDIA'),prompt:text('prompt'),approved:boolean('approved').notNull(),
  createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[
  unique('broll_project_position_uq').on(t.tenantId,t.projectId,t.position),
  foreignKey({columns:[t.tenantId,t.projectId],foreignColumns:[videoProjects.tenantId,videoProjects.id]}),
  foreignKey({columns:[t.tenantId,t.assetId],foreignColumns:[libraryMedia.tenantId,libraryMedia.id]}),
  check('broll_fade_valid',sql`(${t.fadeMs} = 0 or ${t.fadeMs} between 100 and 2000) and 2 * ${t.fadeMs} <= ${t.endMs} - ${t.startMs}`),
  check('broll_position_valid',sql`${t.position} between 0 and 4`),
  check('broll_source_valid',sql`${t.source} = 'USER_MEDIA' and ${t.prompt} is null and ${t.approved} = true`),
  check('broll_timing_valid',sql`${t.startMs} >= 0 and ${t.endMs} <= 180000 and ${t.endMs} - ${t.startMs} >= 100 and ${t.sourceStartMs} >= 0 and ${t.sourceStartMs} + ${t.endMs} - ${t.startMs} <= 180000`),
]);
