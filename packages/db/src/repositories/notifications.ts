import { z } from 'zod';
import { and, desc, eq, inArray, isNull, isNotNull, sql } from 'drizzle-orm';
import { DomainError, type NotificationType, type NotificationAudience, type Role } from '@contentos/types';
import type { Database } from '../index';
import { notifications, notificationReceipts, organizationMembers, users, auditLogs, videoProjects, jobs, publishingJobs, socialConnections, channelAnalyticsJobs, paymentSettlements, paymentTasks, subscriptionTerms } from '../schema';
import { assertMembership, type Transaction } from './ledger';
const roles:Record<NotificationAudience,Role[]>={ALL:['OWNER','ADMIN','MANAGER','EDITOR','CLIENT_APPROVER','VIEWER'],OWNERS:['OWNER'],EDITORS:['OWNER','ADMIN','MANAGER','EDITOR'],APPROVERS:['OWNER','ADMIN','MANAGER','CLIENT_APPROVER'],MANAGERS:['OWNER','ADMIN','MANAGER']};
const audiences=(role:Role)=>(Object.keys(roles) as NotificationAudience[]).filter(key=>roles[key].includes(role));
type Notice={type:NotificationType;audience:NotificationAudience;resourceId:string;brandId?:string};
const actions=['VIDEO_READY','VIDEO_FAILED','VIDEO_RECONCILIATION_REQUIRED','AVATAR_FAILED','AVATAR_RECONCILIATION_REQUIRED','JOB_FAILED','JOB_SUCCEEDED','PUBLICATION_PUBLISHED','PUBLICATION_FAILED','PUBLICATION_RECONCILIATION','PAYMENT_SETTLED','SOCIAL_CHECK_FAILED','CHANNEL_ANALYTICS_FAILED'];
/** Internal projection consumes durable domain facts; HTTP cannot create notifications. */
export class NotificationRepository {
  constructor(private readonly db:Database,private readonly now:()=>Date=()=>new Date()){}
  private async emit(tx:Transaction,tenantId:string,sourceKey:string,notices:Notice[]){
    const inserted=await tx.insert(notificationReceipts).values({tenantId,sourceKey}).onConflictDoNothing().returning({key:notificationReceipts.sourceKey});
    if(!inserted.length)return;
    const members=await tx.select({userId:organizationMembers.userId,role:organizationMembers.role}).from(organizationMembers).innerJoin(users,eq(users.id,organizationMembers.userId)).where(and(eq(organizationMembers.tenantId,tenantId),isNull(users.disabledAt)));
    const rows=notices.flatMap(notice=>members.filter(member=>roles[notice.audience].includes(member.role)).map(member=>({...notice,tenantId,userId:member.userId,sourceKey})));
    if(rows.length)await tx.insert(notifications).values(rows).onConflictDoNothing();
  }
  private async fromAudit(tx:Transaction,event:typeof auditLogs.$inferSelect):Promise<Notice[]>{
    const tenantId=event.tenantId,id=event.resourceId;if(!tenantId||!id)return [];
    if(event.action==='PAYMENT_SETTLED'){
      const [paid]=await tx.select({orderId:paymentSettlements.orderId}).from(paymentSettlements).where(and(eq(paymentSettlements.tenantId,tenantId),eq(paymentSettlements.id,id)));
      return paid?[{type:'PAYMENT_SUCCESS',audience:'OWNERS',resourceId:paid.orderId}]:[];
    }
    if(event.action.startsWith('VIDEO_')){
      const [video]=await tx.select({brandId:videoProjects.brandId}).from(videoProjects).where(and(eq(videoProjects.tenantId,tenantId),eq(videoProjects.id,id)));
      if(!video)return [];
      return event.action==='VIDEO_READY'?[{type:'VIDEO_READY',audience:'ALL',resourceId:id,brandId:video.brandId}]:[{type:'JOB_FAILED',audience:'EDITORS',resourceId:id,brandId:video.brandId}];
    }
    if(event.action.startsWith('PUBLICATION_')){
      const [job]=await tx.select({brandId:publishingJobs.brandId}).from(publishingJobs).where(and(eq(publishingJobs.tenantId,tenantId),eq(publishingJobs.id,id)));
      return job?[{type:event.action==='PUBLICATION_PUBLISHED'?'PUBLICATION_SUCCESS':'PUBLICATION_FAILED',audience:'MANAGERS',resourceId:id,brandId:job.brandId}]:[];
    }
    if(event.action==='SOCIAL_CHECK_FAILED'){
      if(event.metadata.code!=='SOCIAL_TOKEN_EXPIRED')return [];
      const [connection]=await tx.select({brandId:socialConnections.brandId}).from(socialConnections).where(and(eq(socialConnections.tenantId,tenantId),eq(socialConnections.id,id)));
      return connection?[{type:'SOCIAL_TOKEN_EXPIRED',audience:'MANAGERS',resourceId:id,brandId:connection.brandId}]:[];
    }
    if(event.action==='CHANNEL_ANALYTICS_FAILED'){
      const [job]=await tx.select({brandId:channelAnalyticsJobs.brandId}).from(channelAnalyticsJobs).where(and(eq(channelAnalyticsJobs.tenantId,tenantId),eq(channelAnalyticsJobs.id,id)));
      return job?[{type:'JOB_FAILED',audience:'EDITORS',resourceId:id,brandId:job.brandId}]:[];
    }
    const jobId=event.action.startsWith('AVATAR_')?event.metadata.jobId:id;
    if(typeof jobId!=='string'||!z.uuid().safeParse(jobId).success)return [];
    const [job]=await tx.select({brandId:jobs.brandId,type:jobs.type}).from(jobs).where(and(eq(jobs.tenantId,tenantId),eq(jobs.id,jobId)));
    if(!job||(event.action==='JOB_SUCCEEDED'&&job.type!=='GENERATE_SCRIPT'))return [];
    return [{type:event.action==='JOB_SUCCEEDED'?'CONTENT_APPROVAL_REQUIRED':'JOB_FAILED',audience:event.action==='JOB_SUCCEEDED'?'APPROVERS':'EDITORS',resourceId:jobId,brandId:job.brandId}];
  }
  async projectBatch(tenantId?:string){
    return this.db.transaction(async tx=>{
      const events=await tx.select().from(auditLogs).where(and(tenantId?eq(auditLogs.tenantId,tenantId):undefined,isNotNull(auditLogs.tenantId),inArray(auditLogs.action,actions),sql`not exists (select 1 from notification_receipts r where r.source_key='audit:' || ${auditLogs.id}::text)`)).orderBy(auditLogs.createdAt,auditLogs.id).limit(25).for('update',{skipLocked:true});
      for(const event of events)await this.emit(tx,event.tenantId!,`audit:${event.id}`,await this.fromAudit(tx,event));
      const failed=await tx.select({id:paymentTasks.id,tenantId:paymentTasks.tenantId,status:paymentTasks.status}).from(paymentTasks).where(and(tenantId?eq(paymentTasks.tenantId,tenantId):undefined,sql`(${paymentTasks.status} in ('FAILED','RECONCILIATION') or (${paymentTasks.status}='CANCELED' and ${paymentTasks.firstSubmittedAt} is not null))`,sql`not exists (select 1 from notification_receipts r where r.source_key='payment:' || ${paymentTasks.id}::text || ':' || ${paymentTasks.status})`)).limit(25).for('update',{skipLocked:true});
      for(const task of failed)await this.emit(tx,task.tenantId,`payment:${task.id}:${task.status}`,[{type:'PAYMENT_FAILED',audience:'OWNERS',resourceId:task.id}]);
      const now=this.now(),end=new Date(now.getTime()+3*86400000);
      const expiring=await tx.select({id:subscriptionTerms.id,tenantId:subscriptionTerms.tenantId}).from(subscriptionTerms).where(and(tenantId?eq(subscriptionTerms.tenantId,tenantId):undefined,sql`${subscriptionTerms.endsAt} > ${now.toISOString()} and ${subscriptionTerms.endsAt} <= ${end.toISOString()}`,sql`not exists (select 1 from subscription_terms newer where newer.tenant_id=${subscriptionTerms.tenantId} and newer.ends_at>${subscriptionTerms.endsAt})`,sql`not exists (select 1 from notification_receipts r where r.source_key='expiry:' || ${subscriptionTerms.id}::text)`)).limit(25).for('update',{skipLocked:true});
      for(const term of expiring)await this.emit(tx,term.tenantId,`expiry:${term.id}`,[{type:'SUBSCRIPTION_EXPIRING',audience:'OWNERS',resourceId:term.id}]);
      return events.length+failed.length+expiring.length;
    });
  }
  async list(userId:string,tenantId:string,cursor?:string){
    return this.db.transaction(async tx=>{
      const member=await assertMembership(tx,userId,tenantId);
      const visible=and(eq(notifications.tenantId,tenantId),eq(notifications.userId,userId),inArray(notifications.audience,audiences(member.role)));
      const [before]=cursor?await tx.select({id:notifications.id,createdAt:notifications.createdAt}).from(notifications).where(and(visible,eq(notifications.id,cursor))):[];
      if(cursor&&!before)throw new DomainError('NOT_FOUND',404);
      const items=await tx.select({id:notifications.id,type:notifications.type,resourceId:notifications.resourceId,brandId:notifications.brandId,createdAt:notifications.createdAt,readAt:notifications.readAt}).from(notifications).where(and(visible,before?sql`(${notifications.createdAt},${notifications.id}) < (select n.created_at,n.id from notifications n where n.id=${before.id}::uuid)`:undefined)).orderBy(desc(notifications.createdAt),desc(notifications.id)).limit(51);
      const [count]=await tx.select({value:sql<number>`count(*)::int`}).from(notifications).where(and(visible,isNull(notifications.readAt)));
      return {items:items.slice(0,50),nextCursor:items.length>50?items[49]!.id:null,unread:count?.value??0};
    });
  }
  async markRead(userId:string,tenantId:string,id:string){
    return this.db.transaction(async tx=>{
      const member=await assertMembership(tx,userId,tenantId);
      const [row]=await tx.update(notifications).set({readAt:sql`coalesce(${notifications.readAt},now())`}).where(and(eq(notifications.tenantId,tenantId),eq(notifications.userId,userId),eq(notifications.id,id),inArray(notifications.audience,audiences(member.role)))).returning({id:notifications.id,readAt:notifications.readAt});
      if(!row)throw new DomainError('NOT_FOUND',404);return row;
    });
  }
}
