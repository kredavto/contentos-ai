import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../index';
import { emailOutbox, auditLogs } from '../schema';
const eligible=sql`exists (select 1 from auth_tokens t join users u on u.id=t.user_id where t.token_hash=${emailOutbox.tokenHash} and t.user_id=${emailOutbox.userId} and t.consumed_at is null and t.expires_at>now() and u.disabled_at is null and (t.type!='VERIFY_EMAIL' or u.email_verified_at is null))`;
/** Internal worker repository: encrypted messages are never exposed by an HTTP route. */
export class EmailRepository {
  constructor(private readonly db:Database){}
  async claim(id?:string){
    return this.db.transaction(async tx=>{
      const [row]=await tx.select().from(emailOutbox).where(and(id?eq(emailOutbox.id,id):undefined,
        sql`((${emailOutbox.status}='PENDING' and ${emailOutbox.nextAttemptAt}<=now()) or (${emailOutbox.status}='SENDING' and ${emailOutbox.leaseUntil}<=now()))`
      )).orderBy(emailOutbox.nextAttemptAt,emailOutbox.id).limit(1).for('update',{skipLocked:true});
      if(!row)return null;
      const [valid]=await tx.select({id:emailOutbox.id}).from(emailOutbox).where(and(eq(emailOutbox.id,row.id),eligible));
      if(!valid||row.attempt>=8){await tx.update(emailOutbox).set({status:valid?'FAILED':'CANCELED',payload:null,leaseToken:null,leaseUntil:null,completedAt:sql`now()`,errorCode:valid?'DELIVERY_EXHAUSTED':null}).where(eq(emailOutbox.id,row.id));return null;}
      const [claimed]=await tx.update(emailOutbox).set({status:'SENDING',attempt:row.attempt+1,leaseToken:randomUUID(),leaseUntil:sql`now()+interval '60 seconds'`}).where(eq(emailOutbox.id,row.id)).returning();return claimed??null;
    });
  }
  async complete(id:string,leaseToken:string){
    return this.db.transaction(async tx=>{
      const [row]=await tx.update(emailOutbox).set({status:'SENT',payload:null,leaseToken:null,leaseUntil:null,completedAt:sql`now()`,errorCode:null}).where(and(eq(emailOutbox.id,id),eq(emailOutbox.status,'SENDING'),eq(emailOutbox.leaseToken,leaseToken))).returning();
      if(row)await tx.insert(auditLogs).values({userId:row.userId,resourceId:row.id,action:'AUTH_EMAIL_DELIVERED',correlationId:row.correlationId});
      return Boolean(row);
    });
  }
  async fail(id:string,leaseToken:string,code:'CONFIGURATION_REQUIRED'|'PROVIDER_UNAVAILABLE'|'INVALID_INPUT'){
    return this.db.transaction(async tx=>{
      const [row]=await tx.select().from(emailOutbox).where(and(eq(emailOutbox.id,id),eq(emailOutbox.status,'SENDING'),eq(emailOutbox.leaseToken,leaseToken))).for('update');if(!row)return;
      const terminal=row.attempt>=8||code==='INVALID_INPUT';
      await tx.update(emailOutbox).set({status:terminal?'FAILED':'PENDING',payload:terminal?null:row.payload,leaseToken:null,leaseUntil:null,errorCode:code,completedAt:terminal?sql`now()`:null,nextAttemptAt:sql`now()+${Math.min(300,5*2**(row.attempt-1))}*interval '1 second'`}).where(eq(emailOutbox.id,id));
    });
  }
  async cleanup(){
    return this.db.transaction(async tx=>{
      const stale=await tx.select({id:emailOutbox.id}).from(emailOutbox).where(and(inArray(emailOutbox.status,['PENDING','SENDING']),sql`not (${eligible})`)).limit(100).for('update',{skipLocked:true});
      if(stale.length)await tx.update(emailOutbox).set({status:'CANCELED',payload:null,leaseToken:null,leaseUntil:null,completedAt:sql`now()`}).where(inArray(emailOutbox.id,stale.map(row=>row.id)));
      return stale.length;
    });
  }
}
