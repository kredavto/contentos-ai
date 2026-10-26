import {sql} from 'drizzle-orm';
import {pgTable,uuid,text,integer,timestamp,unique,check,index,foreignKey} from 'drizzle-orm/pg-core';
import {users} from './identity';
import {accountDeletionRequests} from './privacy';
/** Separate explicit consent: historical request intake never authorizes execution. */
export const accountErasures=pgTable('account_erasures',{
 id:uuid('id').primaryKey().defaultRandom(),userId:uuid('user_id').notNull().references(()=>users.id),requestId:uuid('request_id').notNull(),
 requestKey:uuid('request_key').notNull(),consentVersion:text('consent_version').notNull(),correlationId:uuid('correlation_id').notNull(),
 status:text('status',{enum:['QUEUED','BLOCKED','COMPLETED']}).notNull().default('QUEUED'),attempt:integer('attempt').notNull().default(0),errorCode:text('error_code'),
 nextAttemptAt:timestamp('next_attempt_at',{withTimezone:true}).notNull().defaultNow(),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),completedAt:timestamp('completed_at',{withTimezone:true}),
},t=>[foreignKey({name:'account_erasure_subject_request_fk',columns:[t.userId,t.requestId],foreignColumns:[accountDeletionRequests.userId,accountDeletionRequests.id]}),unique('account_erasure_user_uq').on(t.userId),unique('account_erasure_request_uq').on(t.requestId),unique('account_erasure_intent_uq').on(t.userId,t.requestKey),index('account_erasure_due_idx').on(t.status,t.nextAttemptAt),
 check('account_erasure_state_valid',sql`${t.status} in ('QUEUED','BLOCKED','COMPLETED') and (${t.status}='COMPLETED')=(${t.completedAt} is not null) and ${t.attempt} between 0 and 3 and ${t.consentVersion}='ACCOUNT_AUTH_DATA_V1'`)]);
