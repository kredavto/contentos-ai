import {sql} from 'drizzle-orm';
import {pgTable,uuid,text,timestamp,unique,foreignKey,index,check} from 'drizzle-orm/pg-core';
import {commentReplyApprovals} from './comment-reply-approvals';
import {users} from './identity';
/** One dispatch intent per immutable approval; uncertain attempts are never replayed. */
export const commentDeliveries=pgTable('comment_deliveries',{
 id:uuid('id').primaryKey().defaultRandom(),tenantId:uuid('tenant_id').notNull(),approvalId:uuid('approval_id').notNull(),requestedBy:uuid('requested_by').notNull().references(()=>users.id),
 idempotencyKey:uuid('idempotency_key').notNull(),correlationId:uuid('correlation_id').notNull(),
 status:text('status',{enum:['QUEUED','ATTEMPTED','REJECTED','RECONCILIATION_REQUIRED','SUCCEEDED']}).notNull().default('QUEUED'),
 attemptId:uuid('attempt_id'),attemptedAt:timestamp('attempted_at',{withTimezone:true}),leaseExpiresAt:timestamp('lease_expires_at',{withTimezone:true}),
 externalCommentId:text('external_comment_id'),publishedAt:timestamp('published_at',{withTimezone:true}),errorCode:text('error_code'),
 dispatchAfter:timestamp('dispatch_after',{withTimezone:true}).notNull().defaultNow(),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),updatedAt:timestamp('updated_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[
 unique('comment_delivery_remote_uq').on(t.tenantId,t.externalCommentId),
 unique('comment_delivery_tenant_uq').on(t.tenantId,t.id),unique('comment_delivery_intent_uq').on(t.tenantId,t.idempotencyKey),unique('comment_delivery_approval_uq').on(t.tenantId,t.approvalId),
 foreignKey({name:'comment_delivery_approval_fk',columns:[t.tenantId,t.approvalId],foreignColumns:[commentReplyApprovals.tenantId,commentReplyApprovals.id]}),
 index('comment_delivery_due_idx').on(t.status,t.dispatchAfter),
 check('comment_delivery_status_valid',sql`${t.status} in ('QUEUED','ATTEMPTED','REJECTED','RECONCILIATION_REQUIRED','SUCCEEDED')`),
 check('comment_delivery_attempt_valid',sql`((${t.attemptId} is null and ${t.attemptedAt} is null and ${t.status} in ('QUEUED','REJECTED')) or (${t.attemptId} is not null and ${t.attemptedAt} is not null and ${t.status}<>'QUEUED'))`),
 check('comment_delivery_lease_valid',sql`((${t.status}='ATTEMPTED' and ${t.leaseExpiresAt} is not null) or (${t.status}<>'ATTEMPTED' and ${t.leaseExpiresAt} is null))`),
 check('comment_delivery_receipt_valid',sql`((${t.status}='SUCCEEDED' and ${t.externalCommentId} is not null and ${t.publishedAt} is not null and ${t.attemptId} is not null) or (${t.status}<>'SUCCEEDED' and ${t.externalCommentId} is null and ${t.publishedAt} is null))`),
]);
