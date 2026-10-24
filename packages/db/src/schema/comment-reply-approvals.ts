import {sql} from 'drizzle-orm';
import {pgTable,uuid,integer,text,jsonb,timestamp,unique,foreignKey,index,check} from 'drizzle-orm/pg-core';
import type {CommentReplyApprovalBinding} from '@contentos/types';
import {commentReplyVersions} from './comment-replies';
import {socialConnections} from './social';
import {users} from './identity';
/** Approval and revocation are immutable events; effective validity is checked against current data. */
export const commentReplyApprovals=pgTable('comment_reply_approvals',{
 id:uuid('id').primaryKey().defaultRandom(),tenantId:uuid('tenant_id').notNull(),publicationId:uuid('publication_id').notNull(),commentId:uuid('comment_id').notNull(),draftId:uuid('draft_id').notNull(),version:integer('version').notNull(),draftRevision:integer('draft_revision').notNull(),
 connectionId:uuid('connection_id').notNull(),binding:jsonb('binding').$type<CommentReplyApprovalBinding>().notNull(),
 approvedBy:uuid('approved_by').notNull().references(()=>users.id),idempotencyKey:uuid('idempotency_key').notNull(),inputHash:text('input_hash').notNull(),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[
 unique('reply_approval_tenant_uq').on(t.tenantId,t.id),unique('reply_approval_intent_uq').on(t.tenantId,t.idempotencyKey),
 foreignKey({name:'reply_approval_version_fk',columns:[t.tenantId,t.publicationId,t.commentId,t.draftId,t.version],foreignColumns:[commentReplyVersions.tenantId,commentReplyVersions.publicationId,commentReplyVersions.commentId,commentReplyVersions.draftId,commentReplyVersions.version]}),
 foreignKey({name:'reply_approval_connection_fk',columns:[t.tenantId,t.connectionId],foreignColumns:[socialConnections.tenantId,socialConnections.id]}),
 index('reply_approval_comment_idx').on(t.tenantId,t.commentId,t.createdAt,t.id),
 check('reply_approval_valid',sql`${t.version}>0 and ${t.draftRevision}>=0 and ${t.inputHash} ~ '^[a-f0-9]{64}$' and jsonb_typeof(${t.binding})='object' and coalesce(${t.binding}->>'connectionId','')=${t.connectionId}::text`),
]);
export const commentReplyApprovalRevocations=pgTable('comment_reply_approval_revocations',{
 id:uuid('id').primaryKey().defaultRandom(),tenantId:uuid('tenant_id').notNull(),approvalId:uuid('approval_id').notNull(),revokedBy:uuid('revoked_by').notNull().references(()=>users.id),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[unique('reply_approval_revocation_uq').on(t.tenantId,t.approvalId),foreignKey({name:'reply_approval_revocation_fk',columns:[t.tenantId,t.approvalId],foreignColumns:[commentReplyApprovals.tenantId,commentReplyApprovals.id]})]);
