import {sql} from 'drizzle-orm';
import {pgTable,uuid,integer,timestamp,unique,foreignKey,check} from 'drizzle-orm/pg-core';
import {videoProjects} from './videos';
import {libraryMedia} from './library-media';

export const videoMusic=pgTable('video_music',{
  id:uuid('id').primaryKey().defaultRandom(),tenantId:uuid('tenant_id').notNull(),projectId:uuid('project_id').notNull(),
  assetId:uuid('asset_id').notNull(),volumePercent:integer('volume_percent').notNull(),
  fadeInMs:integer('fade_in_ms').notNull().default(0),fadeOutMs:integer('fade_out_ms').notNull().default(0),
  createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[
  unique('video_music_project_uq').on(t.tenantId,t.projectId),
  foreignKey({columns:[t.tenantId,t.projectId],foreignColumns:[videoProjects.tenantId,videoProjects.id]}),
  foreignKey({columns:[t.tenantId,t.assetId],foreignColumns:[libraryMedia.tenantId,libraryMedia.id]}),
  check('video_music_fades_valid',sql`(${t.fadeInMs}=0 or ${t.fadeInMs} between 100 and 5000) and (${t.fadeOutMs}=0 or ${t.fadeOutMs} between 100 and 5000)`),
  check('video_music_volume_valid',sql`${t.volumePercent} between 1 and 30`),
]);
