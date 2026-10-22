import {generatedImages} from './images';
import {sql} from 'drizzle-orm';
import {pgTable,uuid,text,integer,timestamp,foreignKey,unique,uniqueIndex,index,check} from 'drizzle-orm/pg-core';
import {users,brands} from './identity';
import {scripts,scriptVersions} from './content';
import {posts,postVersions} from './posts';
import {carousels,carouselVersions} from './carousels';
export const approvalRequests=pgTable('approval_requests',{
  id:uuid('id').primaryKey().defaultRandom(),tenantId:uuid('tenant_id').notNull(),brandId:uuid('brand_id').notNull(),
  entityType:text('entity_type').notNull().default('SCRIPT'),scriptId:uuid('script_id'),postId:uuid('post_id'),carouselId:uuid('carousel_id'),imageId:uuid('image_id'),mediaHash:text('media_hash'),lifecycleRevision:integer('lifecycle_revision'),version:integer('version').notNull(),
  requestedBy:uuid('requested_by').notNull().references(()=>users.id),requestedFrom:uuid('requested_from').notNull().references(()=>users.id),
  requestComment:text('request_comment').notNull(),idempotencyKey:uuid('idempotency_key').notNull(),inputHash:text('input_hash').notNull(),
  status:text('status',{enum:['PENDING','APPROVED','REJECTED','CHANGES_REQUESTED','CANCELLED']}).notNull().default('PENDING'),
  comment:text('comment'),resolvedBy:uuid('resolved_by').references(()=>users.id),resolvedAt:timestamp('resolved_at',{withTimezone:true}),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[unique('approval_intent_uq').on(t.tenantId,t.requestedBy,t.idempotencyKey),uniqueIndex('approval_pending_script_uq').on(t.tenantId,t.scriptId).where(sql`${t.status}='PENDING'`),
  uniqueIndex('approval_pending_post_uq').on(t.tenantId,t.postId).where(sql`${t.status}='PENDING'`),
  uniqueIndex('approval_pending_carousel_uq').on(t.tenantId,t.carouselId).where(sql`${t.status}='PENDING'`),
  foreignKey({columns:[t.tenantId,t.postId],foreignColumns:[posts.tenantId,posts.id]}),
  foreignKey({columns:[t.postId,t.version],foreignColumns:[postVersions.postId,postVersions.version]}),
  foreignKey({columns:[t.tenantId,t.carouselId],foreignColumns:[carousels.tenantId,carousels.id]}),
  foreignKey({columns:[t.carouselId,t.version],foreignColumns:[carouselVersions.carouselId,carouselVersions.version]}),
  check('approval_target_valid',sql`((((${t.entityType}='SCRIPT' and ${t.scriptId} is not null and ${t.postId} is null and ${t.carouselId} is null and ${t.lifecycleRevision} is null) or (${t.entityType}='POST' and ${t.scriptId} is null and ${t.postId} is not null and ${t.carouselId} is null and ${t.lifecycleRevision} is null) or (${t.entityType}='CAROUSEL' and ${t.scriptId} is null and ${t.postId} is null and ${t.carouselId} is not null and ${t.lifecycleRevision} is not null and ${t.lifecycleRevision}>=0)) and ${t.imageId} is null and ${t.mediaHash} is null) or (${t.entityType}='IMAGE' and ${t.imageId} is not null and ${t.scriptId} is null and ${t.postId} is null and ${t.carouselId} is null and ${t.lifecycleRevision} is null and ${t.version}=1 and ${t.mediaHash} is not null and ${t.mediaHash} ~ '^[a-f0-9]{64}$'))`),
  uniqueIndex('approval_pending_image_uq').on(t.tenantId,t.imageId).where(sql`${t.status}='PENDING'`),
  foreignKey({columns:[t.tenantId,t.imageId],foreignColumns:[generatedImages.tenantId,generatedImages.id]}),
  index('approval_tenant_created_idx').on(t.tenantId,t.createdAt,t.id),
  foreignKey({columns:[t.tenantId,t.brandId],foreignColumns:[brands.tenantId,brands.id]}),
  foreignKey({columns:[t.tenantId,t.scriptId],foreignColumns:[scripts.tenantId,scripts.id]}),
  foreignKey({columns:[t.tenantId,t.scriptId,t.version],foreignColumns:[scriptVersions.tenantId,scriptVersions.scriptId,scriptVersions.version]}),
  check('approval_valid',sql`${t.version}>0 and length(${t.requestComment})<=2000 and length(coalesce(${t.comment},''))<=2000 and ${t.inputHash} ~ '^[a-f0-9]{64}$' and ${t.status} in ('PENDING','APPROVED','REJECTED','CHANGES_REQUESTED','CANCELLED') and ((${t.status}='PENDING' and ${t.resolvedBy} is null and ${t.resolvedAt} is null and ${t.comment} is null) or (${t.status}<>'PENDING' and ${t.resolvedBy} is not null and ${t.resolvedAt} is not null and ${t.comment} is not null))`),
]);
