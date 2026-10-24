import {sql} from 'drizzle-orm';
import {pgTable,uuid,integer,text,jsonb,timestamp,unique,foreignKey,index,check} from 'drizzle-orm/pg-core';
import type {CommentReplyInput,CommentReplyOutput} from '@contentos/types';
import {comments} from './comments';
import {users} from './identity';
import {jobs} from './generation';

/** Draft selection is mutable; saved source snapshots and reply versions are append-only. */
export const commentReplyDrafts=pgTable('comment_reply_drafts',{
 id:uuid('id').primaryKey().defaultRandom(),tenantId:uuid('tenant_id').notNull(),publicationId:uuid('publication_id').notNull(),commentId:uuid('comment_id').notNull(),
 currentVersion:integer('current_version').notNull().default(1),revision:integer('revision').notNull().default(0),
 createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),updatedAt:timestamp('updated_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[
 unique('comment_reply_draft_tenant_uq').on(t.tenantId,t.id),
 unique('comment_reply_draft_comment_uq').on(t.tenantId,t.commentId),
 unique('comment_reply_draft_scope_uq').on(t.tenantId,t.publicationId,t.commentId,t.id),
 foreignKey({name:'comment_reply_draft_comment_fk',columns:[t.tenantId,t.publicationId,t.commentId],foreignColumns:[comments.tenantId,comments.publicationId,comments.id]}),
 index('comment_reply_draft_publication_idx').on(t.tenantId,t.publicationId,t.updatedAt,t.id),
 check('comment_reply_draft_revision_valid',sql`${t.currentVersion}>0 and ${t.revision}>=0`),
]);
export const commentReplyVersions=pgTable('comment_reply_versions',{
 id:uuid('id').primaryKey().defaultRandom(),tenantId:uuid('tenant_id').notNull(),publicationId:uuid('publication_id').notNull(),commentId:uuid('comment_id').notNull(),draftId:uuid('draft_id').notNull(),version:integer('version').notNull(),
 source:text('source',{enum:['AI','HUMAN']}).notNull(),input:jsonb('input').$type<CommentReplyInput>().notNull(),content:jsonb('content').$type<CommentReplyOutput>().notNull(),
 jobId:uuid('job_id'),createdBy:uuid('created_by').notNull().references(()=>users.id),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[
 unique('comment_reply_version_tenant_uq').on(t.tenantId,t.id),unique('comment_reply_version_number_uq').on(t.tenantId,t.draftId,t.version),unique('comment_reply_version_job_uq').on(t.jobId),
 foreignKey({name:'comment_reply_version_draft_fk',columns:[t.tenantId,t.publicationId,t.commentId,t.draftId],foreignColumns:[commentReplyDrafts.tenantId,commentReplyDrafts.publicationId,commentReplyDrafts.commentId,commentReplyDrafts.id]}),
 foreignKey({name:'comment_reply_version_job_fk',columns:[t.tenantId,t.jobId],foreignColumns:[jobs.tenantId,jobs.id]}),
 check('comment_reply_version_source_valid',sql`${t.version}>0 and ((${t.source}='AI' and ${t.jobId} is not null) or (${t.source}='HUMAN' and ${t.jobId} is null))`),
 check('comment_reply_version_input_valid',sql`jsonb_typeof(${t.input})='object' and coalesce(${t.input}->'comment'->>'id','')=${t.commentId}::text and coalesce(jsonb_typeof(${t.input}->'comment'->'contentRevision'),'')='number' and coalesce(jsonb_typeof(${t.input}->'comment'->'reviewRevision'),'')='number'`),
 check('comment_reply_version_content_valid',sql`jsonb_typeof(${t.content})='object' and ${t.content} ? 'reply' and (${t.content}->'reply'='null'::jsonb or (jsonb_typeof(${t.content}->'reply')='string' and length(${t.content}->>'reply') between 1 and 2000)) and coalesce(jsonb_typeof(${t.content}->'risks'),'')='array' and jsonb_array_length(${t.content}->'risks')<=8`),
]);
