import {sql} from 'drizzle-orm';
import {pgTable,uuid,text,integer,boolean,timestamp,unique,foreignKey,index,check} from 'drizzle-orm/pg-core';
import {publications} from './publishing';

/** Imported provider facts and local review state have independent revisions. */
export const comments=pgTable('comments',{
  id:uuid('id').primaryKey().defaultRandom(),
  tenantId:uuid('tenant_id').notNull(),
  publicationId:uuid('publication_id').notNull(),
  provider:text('provider').notNull(),
  externalCommentId:text('external_comment_id').notNull(),
  externalThreadId:text('external_thread_id').notNull(),
  parentId:uuid('parent_id'),
  externalAuthorId:text('external_author_id'),
  authorName:text('author_name'),
  text:text('text').notNull(),
  providerCreatedAt:timestamp('provider_created_at',{withTimezone:true}).notNull(),
  providerUpdatedAt:timestamp('provider_updated_at',{withTimezone:true}).notNull(),
  firstObservedAt:timestamp('first_observed_at',{withTimezone:true}).notNull(),
  lastObservedAt:timestamp('last_observed_at',{withTimezone:true}).notNull(),
  replyCount:integer('reply_count'),
  canReply:boolean('can_reply'),
  isPublic:boolean('is_public'),
  contentRevision:integer('content_revision').notNull().default(0),
  revision:integer('revision').notNull().default(0),
  sentiment:text('sentiment',{enum:['POSITIVE','NEUTRAL','NEGATIVE']}),
  status:text('status',{enum:['NEW','NEEDS_HUMAN','RESOLVED']}).notNull().default('NEW'),
  createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
  updatedAt:timestamp('updated_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[
  unique('comment_tenant_id_uq').on(t.tenantId,t.id),
  unique('comment_publication_identity_uq').on(t.tenantId,t.publicationId,t.id),
  unique('comment_external_identity_uq').on(t.tenantId,t.publicationId,t.provider,t.externalCommentId),
  unique('comment_thread_identity_uq').on(t.tenantId,t.publicationId,t.provider,t.externalThreadId,t.id),
  foreignKey({name:'comment_publication_fk',columns:[t.tenantId,t.publicationId],foreignColumns:[publications.tenantId,publications.id]}),
  foreignKey({name:'comment_parent_thread_fk',columns:[t.tenantId,t.publicationId,t.provider,t.externalThreadId,t.parentId],foreignColumns:[t.tenantId,t.publicationId,t.provider,t.externalThreadId,t.id]}),
  index('comment_inbox_idx').on(t.tenantId,t.publicationId,t.status,t.providerCreatedAt,t.id),
  index('comment_parent_idx').on(t.tenantId,t.publicationId,t.parentId,t.providerCreatedAt,t.id),
  check('comment_identity_valid',sql`${t.provider}='youtube' and ${t.externalCommentId} ~ '^[A-Za-z0-9_.-]+$' and length(${t.externalCommentId}) between 1 and 256 and ${t.externalThreadId} ~ '^[A-Za-z0-9_.-]+$' and length(${t.externalThreadId}) between 1 and 256 and (${t.parentId} is null or ${t.parentId}<>${t.id})`),
  check('comment_content_valid',sql`length(${t.text})<=10000 and (${t.authorName} is null or length(${t.authorName})<=1000) and (${t.externalAuthorId} is null or ${t.externalAuthorId} ~ '^UC[A-Za-z0-9_-]{22}$')`),
  check('comment_time_valid',sql`${t.providerUpdatedAt}>=${t.providerCreatedAt} and ${t.lastObservedAt}>=${t.firstObservedAt}`),
  check('comment_thread_valid',sql`((${t.parentId} is null and ${t.replyCount} is not null and ${t.replyCount}>=0 and ${t.canReply} is not null and ${t.isPublic} is not null) or (${t.parentId} is not null and ${t.replyCount} is null and ${t.canReply} is null and ${t.isPublic} is null))`),
  check('comment_review_valid',sql`${t.contentRevision}>=0 and ${t.revision}>=0 and ${t.status} in ('NEW','NEEDS_HUMAN','RESOLVED') and (${t.sentiment} is null or ${t.sentiment} in ('POSITIVE','NEUTRAL','NEGATIVE'))`),
]);
