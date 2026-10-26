import {sql} from 'drizzle-orm';
import {pgTable,uuid,text,integer,timestamp,unique,check,index,foreignKey,type AnyPgColumn} from 'drizzle-orm/pg-core';
import {users} from './identity';
import {accountDeletionRequests} from './privacy';
/** Separate explicit consent: historical request intake never authorizes execution. */
export const accountErasures=pgTable('account_erasures',{
 id:uuid('id').primaryKey().defaultRandom(),userId:uuid('user_id').notNull().references(()=>users.id),requestId:uuid('request_id').notNull(),
 requestKey:uuid('request_key').notNull(),consentVersion:text('consent_version').notNull(),correlationId:uuid('correlation_id').notNull(),
 recoveryId:uuid('recovery_id'),
 status:text('status',{enum:['QUEUED','BLOCKED','COMPLETED']}).notNull().default('QUEUED'),attempt:integer('attempt').notNull().default(0),errorCode:text('error_code'),
 nextAttemptAt:timestamp('next_attempt_at',{withTimezone:true}).notNull().defaultNow(),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),completedAt:timestamp('completed_at',{withTimezone:true}),
},t=>[foreignKey({name:'account_erasure_recovery_scope_fk',columns:[t.id,t.recoveryId],foreignColumns:[accountErasureRecoveries.erasureId,accountErasureRecoveries.id]}),foreignKey({name:'account_erasure_subject_request_fk',columns:[t.userId,t.requestId],foreignColumns:[accountDeletionRequests.userId,accountDeletionRequests.id]}),unique('account_erasure_user_uq').on(t.userId),unique('account_erasure_request_uq').on(t.requestId),unique('account_erasure_intent_uq').on(t.userId,t.requestKey),index('account_erasure_due_idx').on(t.status,t.nextAttemptAt),
 check('account_erasure_state_valid',sql`${t.status} in ('QUEUED','BLOCKED','COMPLETED') and (${t.status}='COMPLETED')=(${t.completedAt} is not null) and ${t.attempt} between 0 and 3 and ${t.consentVersion}='ACCOUNT_AUTH_DATA_V1'`)]);

/** Recovery is an operator action on existing immutable consent, not new erasure authority. */
export const accountErasureRecoveries=pgTable('account_erasure_recoveries',{
 id:uuid('id').primaryKey().defaultRandom(),erasureId:uuid('erasure_id').notNull().references(():AnyPgColumn=>accountErasures.id),actorId:uuid('actor_id').notNull().references(()=>users.id),
 previousRecoveryId:uuid('previous_recovery_id'),requestKey:uuid('request_key').notNull(),inputHash:text('input_hash').notNull(),reason:text('reason',{enum:['DEPENDENCIES_RESOLVED','TRANSIENT_FAILURE_RESOLVED']}).notNull(),ticket:text('ticket').notNull(),
 previousAttempt:integer('previous_attempt').notNull(),previousErrorCode:text('previous_error_code'),correlationId:uuid('correlation_id').notNull(),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[foreignKey({name:'account_erasure_recovery_previous_fk',columns:[t.erasureId,t.previousRecoveryId],foreignColumns:[t.erasureId,t.id]}),unique('account_erasure_recovery_scope_uq').on(t.erasureId,t.id),unique('account_erasure_recovery_intent_uq').on(t.actorId,t.requestKey),index('account_erasure_recovery_history_idx').on(t.erasureId,t.createdAt,t.id),
 check('account_erasure_recovery_valid',sql`${t.reason} in ('DEPENDENCIES_RESOLVED','TRANSIENT_FAILURE_RESOLVED') and ${t.ticket} ~ '^[A-Za-z0-9_-]{3,80}$' and ${t.inputHash} ~ '^[a-f0-9]{64}$' and ${t.previousAttempt} between 0 and 3`)]);
