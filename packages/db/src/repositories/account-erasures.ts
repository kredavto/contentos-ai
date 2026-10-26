import {and,asc,eq,inArray,isNull,isNotNull,lte,sql} from 'drizzle-orm';
import {DomainError} from '@contentos/types';
import type {Database} from '../index';
import {users,sessions,authTokens,emailOutbox,accountDeletionRequests,accountErasures,auditLogs} from '../schema';
import type {Transaction} from './ledger';
const allowedReferences=new Set(['sessions.user_id','auth_tokens.user_id','audit_logs.user_id','account_deletion_requests.user_id','account_erasures.user_id']);
/** Fail closed on every other direct user FK, including newly added product modules. */
async function dependencies(tx:Transaction,userId:string){
 const references=await tx.execute<{schema_name:string;table_name:string;column_name:string;key_count:number}>(sql`
  select ns.nspname as schema_name,cl.relname as table_name,at.attname as column_name,cardinality(fk.conkey) as key_count
  from pg_constraint fk join pg_class cl on cl.oid=fk.conrelid join pg_namespace ns on ns.oid=cl.relnamespace
  join pg_attribute at on at.attrelid=fk.conrelid and at.attnum=fk.conkey[1]
  where fk.contype='f' and fk.confrelid='public.users'::regclass`);
 for(const reference of references){
  if(reference.key_count!==1)throw new DomainError('CONFIGURATION_REQUIRED',503);
  if(reference.schema_name==='public'&&allowedReferences.has(reference.table_name+'.'+reference.column_name))continue;
  const [row]=await tx.execute<{present:boolean}>(sql`select exists(select 1 from ${sql.identifier(reference.schema_name)}.${sql.identifier(reference.table_name)} where ${sql.identifier(reference.column_name)}=${userId}::uuid) as present`);
  if(row?.present)return true;
 }
 return false;
}
async function lockMail(tx:Transaction,userId:string){
 const rows=await tx.select({status:emailOutbox.status}).from(emailOutbox).where(and(eq(emailOutbox.userId,userId),inArray(emailOutbox.status,['PENDING','SENDING','RECONCILIATION']))).limit(1001).for('update');
 return rows.length>1000||rows.some(row=>row.status==='SENDING'||row.status==='RECONCILIATION');
}
export class AccountErasureRepository{
 constructor(private readonly db:Database){}
 async eligibility(userId:string){return this.db.transaction(async tx=>{
  await tx.execute(sql`set local statement_timeout='5s'`);
  const [user]=await tx.select({id:users.id}).from(users).where(and(eq(users.id,userId),isNull(users.disabledAt),isNotNull(users.emailVerifiedAt))).for('share');if(!user)throw new DomainError('NOT_AUTHORIZED',403);
  const resourceReview=await dependencies(tx,userId),mailReview=await tx.select({id:emailOutbox.id}).from(emailOutbox).where(and(eq(emailOutbox.userId,userId),inArray(emailOutbox.status,['SENDING','RECONCILIATION']))).limit(1);
  return {eligible:!resourceReview&&!mailReview.length,resourceReview,mailReview:mailReview.length>0};
 });}
 async request(userId:string,passwordHash:string,input:{requestId:string;revision:string;idempotencyKey:string},correlationId:string){return this.db.transaction(async tx=>{
  await tx.execute(sql`set local statement_timeout='5s'`);
  // Allow FK-only mail receipt commits while fencing password/session and membership changes.
  const [user]=await tx.select().from(users).where(eq(users.id,userId)).for('no key update');if(!user)throw new DomainError('NOT_AUTHORIZED',403);
  const [existing]=await tx.select().from(accountErasures).where(eq(accountErasures.userId,userId));
  if(existing){if(existing.requestKey!==input.idempotencyKey||existing.requestId!==input.requestId)throw new DomainError('CONFLICT',409);return {id:existing.id,status:existing.status};}
  if(user.disabledAt||!user.emailVerifiedAt||user.passwordHash!==passwordHash)throw new DomainError('NOT_AUTHORIZED',403);
  const [request]=await tx.select().from(accountDeletionRequests).where(and(eq(accountDeletionRequests.id,input.requestId),eq(accountDeletionRequests.userId,userId))).for('update');
  if(!request||request.status!=='REQUESTED'||request.revision!==input.revision)throw new DomainError('CONFLICT',409);
  if(await dependencies(tx,userId)||await lockMail(tx,userId))throw new DomainError('CONFLICT',409);
  const [execution]=await tx.insert(accountErasures).values({userId,requestId:request.id,requestKey:input.idempotencyKey,consentVersion:'ACCOUNT_AUTH_DATA_V1',correlationId}).returning();
  await tx.update(users).set({disabledAt:sql`clock_timestamp()`}).where(eq(users.id,userId));
  await tx.delete(sessions).where(eq(sessions.userId,userId));
  await tx.update(authTokens).set({consumedAt:sql`clock_timestamp()`}).where(and(eq(authTokens.userId,userId),isNull(authTokens.consumedAt)));
  await tx.update(emailOutbox).set({status:'CANCELED',payload:null,leaseToken:null,leaseUntil:null,completedAt:sql`clock_timestamp()`}).where(and(eq(emailOutbox.userId,userId),eq(emailOutbox.status,'PENDING')));
  await tx.insert(auditLogs).values({userId,resourceId:execution!.id,action:'ACCOUNT_AUTH_ERASURE_CONFIRMED',correlationId,metadata:{scope:'ACCOUNT_AUTH_DATA_V1'}});
  return {id:execution!.id,status:execution!.status};
 });}
 async due(){const [job]=await this.db.select({id:accountErasures.id,correlationId:accountErasures.correlationId}).from(accountErasures).where(and(eq(accountErasures.status,'QUEUED'),lte(accountErasures.nextAttemptAt,sql`now()`))).orderBy(asc(accountErasures.createdAt),asc(accountErasures.id)).limit(1);return job??null;}
 async execute(id:string){return this.db.transaction(async tx=>{
  await tx.execute(sql`set local statement_timeout='5s'`);
  const [candidate]=await tx.select({userId:accountErasures.userId}).from(accountErasures).where(eq(accountErasures.id,id));if(!candidate)return;
  const [user]=await tx.select().from(users).where(eq(users.id,candidate.userId)).for('update');
  const [job]=await tx.select().from(accountErasures).where(eq(accountErasures.id,id)).for('update');if(!job||job.status!=='QUEUED')return;
  if(!user||!user.disabledAt||user.erasedAt)throw new DomainError('CONFLICT',409);
  if(await dependencies(tx,user.id)||await lockMail(tx,user.id)){
   await tx.update(accountErasures).set({status:'BLOCKED',errorCode:'RESOURCE_REVIEW_REQUIRED'}).where(eq(accountErasures.id,id));
   await tx.insert(auditLogs).values({userId:user.id,resourceId:id,action:'ACCOUNT_AUTH_ERASURE_BLOCKED',correlationId:job.correlationId});return;
  }
  await tx.delete(sessions).where(eq(sessions.userId,user.id));
  // The FK cascade removes encrypted mail and token hashes together, after the uncertain-send gate.
  await tx.delete(authTokens).where(eq(authTokens.userId,user.id));
  await tx.update(users).set({email:`deleted+${user.id}@account.invalid`,name:'Удалённый аккаунт',passwordHash:`ERASED:${user.id}`,emailVerifiedAt:null,erasedAt:sql`clock_timestamp()`}).where(eq(users.id,user.id));
  await tx.update(accountErasures).set({status:'COMPLETED',completedAt:sql`clock_timestamp()`,errorCode:null}).where(eq(accountErasures.id,id));
  await tx.insert(auditLogs).values({userId:user.id,resourceId:id,action:'ACCOUNT_AUTH_ERASURE_COMPLETED',correlationId:job.correlationId,metadata:{scope:'ACCOUNT_AUTH_DATA_V1'}});
 });}
 async fail(id:string){await this.db.update(accountErasures).set({attempt:sql`${accountErasures.attempt}+1`,status:sql`case when ${accountErasures.attempt}>=2 then 'BLOCKED' else 'QUEUED' end`,nextAttemptAt:sql`now()+interval '30 seconds'`,errorCode:'ERASURE_FAILED'}).where(and(eq(accountErasures.id,id),eq(accountErasures.status,'QUEUED')));}
}
