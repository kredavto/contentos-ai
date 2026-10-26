import {createHash} from 'node:crypto';
import {and,eq,sql} from 'drizzle-orm';
import {DomainError,accountErasureRecoverySchema,type AccountErasureRecoveryInput} from '@contentos/types';
import type {Database} from '../index';
import {accountErasures,accountErasureRecoveries,users,auditLogs} from '../schema';
import {assertPlatformOperator} from './admin';
import {accountErasureDependencies,lockAccountErasureMail} from './account-erasures';
/** Requeues only the original self-confirmed database-only scope after a fresh dependency check. */
export class AccountErasureRecoveryRepository{
 constructor(private readonly db:Database){}
 async retry(actorId:string,id:string,raw:AccountErasureRecoveryInput,correlationId:string){
  const input=accountErasureRecoverySchema.parse(raw),inputHash=createHash('sha256').update(JSON.stringify({id,...input})).digest('hex');
  return this.db.transaction(async tx=>{
   await tx.execute(sql`set local statement_timeout='5s'`);
   if((await assertPlatformOperator(tx,actorId)).role!=='ADMIN')throw new DomainError('NOT_AUTHORIZED',403);
   await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${actorId+'/'+input.idempotencyKey},0))`);
   const [candidate]=await tx.select({userId:accountErasures.userId}).from(accountErasures).where(eq(accountErasures.id,id));if(!candidate)throw new DomainError('NOT_FOUND',404);
   const [user]=await tx.select().from(users).where(eq(users.id,candidate.userId)).for('no key update');
   const [job]=await tx.select().from(accountErasures).where(eq(accountErasures.id,id)).for('update');if(!job)throw new DomainError('NOT_FOUND',404);
   const [existing]=await tx.select().from(accountErasureRecoveries).where(and(eq(accountErasureRecoveries.actorId,actorId),eq(accountErasureRecoveries.requestKey,input.idempotencyKey)));
   if(existing){if(existing.erasureId!==id||existing.inputHash!==inputHash)throw new DomainError('CONFLICT',409);return {id:job.id,status:job.status,recoveryId:existing.id};}
   if(job.status!=='BLOCKED'||job.recoveryId!==input.expectedRecoveryId||job.consentVersion!=='ACCOUNT_AUTH_DATA_V1'||!user?.disabledAt||user.erasedAt)throw new DomainError('CONFLICT',409);
   if(await accountErasureDependencies(tx,user.id)||await lockAccountErasureMail(tx,user.id))throw new DomainError('CONFLICT',409);
   const [recovery]=await tx.insert(accountErasureRecoveries).values({erasureId:id,actorId,previousRecoveryId:job.recoveryId,requestKey:input.idempotencyKey,inputHash,reason:input.reason,ticket:input.ticket,previousAttempt:job.attempt,previousErrorCode:job.errorCode,correlationId}).returning();
   const [queued]=await tx.update(accountErasures).set({status:'QUEUED',attempt:0,errorCode:null,recoveryId:recovery!.id,nextAttemptAt:sql`clock_timestamp()`}).where(eq(accountErasures.id,id)).returning();
   await tx.insert(auditLogs).values({userId:actorId,resourceId:id,action:'ADMIN_ACCOUNT_ERASURE_RECOVERED',correlationId,metadata:{recoveryId:recovery!.id,reason:input.reason,ticket:input.ticket,scope:job.consentVersion}});
   return {id:queued!.id,status:queued!.status,recoveryId:recovery!.id};
  });
 }
}
