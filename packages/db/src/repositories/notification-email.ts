import {randomUUID} from 'node:crypto';
import {and,eq,inArray,sql} from 'drizzle-orm';
import type {Database} from '../index';
import {notificationEmailDeliveries as deliveries,notifications,notificationPreferences,users,auditLogs} from '../schema';
// SQL aliases are confined to the two eligibility subqueries below.
const audience=sql`(n.audience='ALL' or (n.audience='OWNERS' and m.role='OWNER') or (n.audience='EDITORS' and m.role in ('OWNER','ADMIN','MANAGER','EDITOR')) or (n.audience='APPROVERS' and m.role in ('OWNER','ADMIN','MANAGER','CLIENT_APPROVER')) or (n.audience='MANAGERS' and m.role in ('OWNER','ADMIN','MANAGER')))`;
const eligible=sql`exists (select 1 from notifications n join notification_preferences p on p.tenant_id=n.tenant_id and p.user_id=n.user_id join organization_members m on m.tenant_id=n.tenant_id and m.user_id=n.user_id join users u on u.id=n.user_id where n.id=${deliveries.notificationId} and n.tenant_id=${deliveries.tenantId} and n.user_id=${deliveries.userId} and p.email_enabled and p.revision=${deliveries.preferenceRevision} and n.created_at>=p.enabled_at and u.disabled_at is null and u.email_verified_at is not null and ${audience})`;
/** Internal worker only. No recipient address or email body is stored in the delivery queue. */
export class NotificationEmailRepository {
  constructor(private readonly db:Database){}
  async projectBatch(){
    return this.db.transaction(async tx=>{
      const rows=await tx.select({notificationId:notifications.id,tenantId:notifications.tenantId,userId:notifications.userId,preferenceRevision:notificationPreferences.revision}).from(notifications).innerJoin(notificationPreferences,and(eq(notificationPreferences.tenantId,notifications.tenantId),eq(notificationPreferences.userId,notifications.userId))).where(and(eq(notificationPreferences.emailEnabled,true),sql`${notifications.createdAt}>=${notificationPreferences.enabledAt}`,sql`not exists (select 1 from notification_email_deliveries d where d.notification_id=${notifications.id})`)).orderBy(notifications.createdAt,notifications.id).limit(100);
      if(rows.length)await tx.insert(deliveries).values(rows).onConflictDoNothing();return rows.length;
    });
  }
  async cleanup(){
    return this.db.transaction(async tx=>{
      const rows=await tx.select({id:deliveries.id}).from(deliveries).where(and(
        sql`(${deliveries.status}='PENDING' or (${deliveries.status}='SENDING' and ${deliveries.submittedAt} is null))`,sql`not (${eligible})`
      )).orderBy(deliveries.id).limit(100).for('update',{skipLocked:true});
      if(rows.length)await tx.update(deliveries).set({status:'CANCELED',leaseToken:null,leaseUntil:null,completedAt:sql`now()`,errorCode:null}).where(inArray(deliveries.id,rows.map(row=>row.id)));
      return rows.length;
    });
  }
  async claim(id?:string){
    return this.db.transaction(async tx=>{
      const [row]=await tx.select().from(deliveries).where(and(id?eq(deliveries.id,id):undefined,sql`((${deliveries.status}='PENDING' and ${deliveries.nextAttemptAt}<=now()) or (${deliveries.status}='SENDING' and ${deliveries.leaseUntil}<=now()))`)).orderBy(deliveries.nextAttemptAt,deliveries.id).limit(1).for('update',{skipLocked:true});
      if(!row)return null;
      const [valid]=await tx.select({id:deliveries.id}).from(deliveries).where(and(eq(deliveries.id,row.id),eligible));
      const uncertain=row.status==='SENDING'&&!!row.submittedAt;
      if(uncertain||!valid||row.attempt>=8){
        const status=uncertain?'RECONCILIATION':!valid?'CANCELED':'FAILED';
        await tx.update(deliveries).set({status,leaseToken:null,leaseUntil:null,completedAt:sql`now()`,errorCode:uncertain?'DELIVERY_UNCERTAIN':valid?'DELIVERY_EXHAUSTED':null}).where(eq(deliveries.id,row.id));
        if(uncertain)await tx.insert(auditLogs).values({tenantId:row.tenantId,userId:row.userId,resourceId:row.id,action:'NOTIFICATION_EMAIL_RECONCILIATION_REQUIRED',correlationId:row.id});return null;
      }
      const [claimed]=await tx.update(deliveries).set({status:'SENDING',attempt:row.attempt+1,leaseToken:randomUUID(),leaseUntil:sql`now()+interval '60 seconds'`}).where(eq(deliveries.id,row.id)).returning();return claimed??null;
    });
  }
  async begin(id:string,leaseToken:string){
    return this.db.transaction(async tx=>{
      const [row]=await tx.update(deliveries).set({submittedAt:sql`now()`,leaseUntil:sql`now()+interval '60 seconds'`}).where(and(eq(deliveries.id,id),eq(deliveries.status,'SENDING'),eq(deliveries.leaseToken,leaseToken),sql`${deliveries.leaseUntil}>now()`,sql`${deliveries.submittedAt} is null`,eligible)).returning();
      if(!row)return null;
      const [message]=await tx.select({recipient:users.email,type:notifications.type}).from(notifications).innerJoin(users,eq(users.id,notifications.userId)).where(eq(notifications.id,row.notificationId));
      return message?{...message,tenantId:row.tenantId}:null;
    });
  }
  async complete(id:string,leaseToken:string){
    return this.db.transaction(async tx=>{
      const [row]=await tx.update(deliveries).set({status:'SENT',leaseToken:null,leaseUntil:null,completedAt:sql`now()`,errorCode:null}).where(and(eq(deliveries.id,id),eq(deliveries.status,'SENDING'),eq(deliveries.leaseToken,leaseToken),sql`${deliveries.leaseUntil}>now()`)).returning();
      if(row)await tx.insert(auditLogs).values({tenantId:row.tenantId,userId:row.userId,resourceId:id,action:'NOTIFICATION_EMAIL_DELIVERED',correlationId:id});return !!row;
    });
  }
  async fail(id:string,leaseToken:string,uncertain:boolean){
    return this.db.transaction(async tx=>{
      const [row]=await tx.select().from(deliveries).where(and(eq(deliveries.id,id),eq(deliveries.status,'SENDING'),eq(deliveries.leaseToken,leaseToken),sql`${deliveries.leaseUntil}>now()`)).for('update');if(!row)return;
      const terminal=uncertain||row.attempt>=8;
      await tx.update(deliveries).set({status:uncertain?'RECONCILIATION':terminal?'FAILED':'PENDING',submittedAt:terminal?row.submittedAt:null,leaseToken:null,leaseUntil:null,completedAt:terminal?sql`now()`:null,errorCode:uncertain?'DELIVERY_UNCERTAIN':'PROVIDER_UNAVAILABLE',nextAttemptAt:sql`now()+${Math.min(300,5*2**(row.attempt-1))}*interval '1 second'`}).where(eq(deliveries.id,id));
      if(uncertain)await tx.insert(auditLogs).values({tenantId:row.tenantId,userId:row.userId,resourceId:id,action:'NOTIFICATION_EMAIL_RECONCILIATION_REQUIRED',correlationId:id});
    });
  }
}
