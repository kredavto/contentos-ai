import {randomUUID} from 'node:crypto';
import {and,eq,inArray,asc,desc,lte,gte,or} from 'drizzle-orm';
import {DomainError,channelObservationSchema,type ChannelObservation,type ChannelAnalyticsState,type ErrorCode} from '@contentos/types';
import type {Database} from '../index';
import {brands,socialConnections,channelAnalyticsJobs,channelMetrics,channelMetricEvidence,auditLogs} from '../schema';
import {assertMembership,lockTenant,type Transaction} from './ledger';
type Job=typeof channelAnalyticsJobs.$inferSelect;
const where=(tenantId:string,id:string)=>and(eq(channelAnalyticsJobs.tenantId,tenantId),eq(channelAnalyticsJobs.id,id));
const metricProjection={id:channelMetrics.id,connectionId:channelMetrics.connectionId,source:channelMetrics.source,memberCount:channelMetrics.memberCount,observedAt:channelMetrics.observedAt,recordedAt:channelMetrics.recordedAt};
const jobProjection={id:channelAnalyticsJobs.id,connectionId:channelAnalyticsJobs.connectionId,status:channelAnalyticsJobs.status,attempt:channelAnalyticsJobs.attempt,errorCode:channelAnalyticsJobs.errorCode,createdAt:channelAnalyticsJobs.createdAt,nextAttemptAt:channelAnalyticsJobs.nextAttemptAt};
async function authorize(tx:Transaction,userId:string,tenantId:string,brandId:string,write=false){await assertMembership(tx,userId,tenantId,write?'strategy':'read');const [brand]=await tx.select({id:brands.id}).from(brands).where(and(eq(brands.tenantId,tenantId),eq(brands.id,brandId)));if(!brand)throw new DomainError('NOT_FOUND',404);}
async function source(tx:Transaction,tenantId:string,brandId:string,id:string){const [row]=await tx.select().from(socialConnections).where(and(eq(socialConnections.tenantId,tenantId),eq(socialConnections.brandId,brandId),eq(socialConnections.id,id)));if(!row)throw new DomainError('NOT_FOUND',404);return row;}
async function transition(tx:Transaction,job:Job,status:ChannelAnalyticsState,code:ErrorCode|null=null,actor=job.requestedBy){
  await tx.update(channelAnalyticsJobs).set({status,errorCode:code,...(['SUCCEEDED','FAILED','CANCELLED'].includes(status)?{finishedAt:new Date(),leaseExpiresAt:null}:{})}).where(where(job.tenantId,job.id));
  await tx.insert(auditLogs).values({tenantId:job.tenantId,userId:actor,action:`CHANNEL_ANALYTICS_${status}`,resourceId:job.id,correlationId:job.correlationId,metadata:{from:job.status,to:status,attempt:job.attempt,code}});
}
export async function cancelConnectionAnalytics(tx:Transaction,tenantId:string,connectionId:string,actor:string){
  const rows=await tx.select().from(channelAnalyticsJobs).where(and(eq(channelAnalyticsJobs.tenantId,tenantId),eq(channelAnalyticsJobs.connectionId,connectionId),inArray(channelAnalyticsJobs.status,['QUEUED','RUNNING'])));
  for(const row of rows)await transition(tx,row,'CANCELLED','SOCIAL_TOKEN_EXPIRED',actor);
}
export class ChannelAnalyticsRepository{
  constructor(private readonly db:Database,private readonly now:()=>Date=()=>new Date()){}
  async overview(userId:string,tenantId:string,brandId:string){return this.db.transaction(async tx=>{
    await authorize(tx,userId,tenantId,brandId);
    const channels=await tx.select({id:socialConnections.id,name:socialConnections.name,provider:socialConnections.provider,status:socialConnections.status}).from(socialConnections).where(and(eq(socialConnections.tenantId,tenantId),eq(socialConnections.brandId,brandId))).orderBy(desc(socialConnections.createdAt)).limit(100);
    if(!channels.length)return [];
    const ids=channels.map(row=>row.id);
    const latest=await tx.selectDistinctOn([channelMetrics.connectionId],metricProjection).from(channelMetrics).where(and(eq(channelMetrics.tenantId,tenantId),inArray(channelMetrics.connectionId,ids))).orderBy(channelMetrics.connectionId,desc(channelMetrics.observedAt),desc(channelMetrics.recordedAt),desc(channelMetrics.id));
    const jobs=await tx.selectDistinctOn([channelAnalyticsJobs.connectionId],jobProjection).from(channelAnalyticsJobs).where(and(eq(channelAnalyticsJobs.tenantId,tenantId),inArray(channelAnalyticsJobs.connectionId,ids))).orderBy(channelAnalyticsJobs.connectionId,desc(channelAnalyticsJobs.createdAt),desc(channelAnalyticsJobs.id));
    const metricsById=new Map(latest.map(row=>[row.connectionId,row])),jobsById=new Map(jobs.map(row=>[row.connectionId,row]));
    return channels.map(row=>({...row,latest:metricsById.get(row.id)??null,job:jobsById.get(row.id)??null}));
  });}
  async history(userId:string,tenantId:string,brandId:string,id:string){return this.db.transaction(async tx=>{await authorize(tx,userId,tenantId,brandId);await source(tx,tenantId,brandId,id);return tx.select(metricProjection).from(channelMetrics).where(and(eq(channelMetrics.tenantId,tenantId),eq(channelMetrics.connectionId,id))).orderBy(desc(channelMetrics.observedAt),desc(channelMetrics.recordedAt),desc(channelMetrics.id)).limit(100);});}
  async request(userId:string,tenantId:string,brandId:string,connectionId:string,key:string,configured:{name:string;source:'API'|'DEMO'},correlationId:string){return this.db.transaction(async tx=>{
    await lockTenant(tx,tenantId);await authorize(tx,userId,tenantId,brandId,true);
    const channel=await source(tx,tenantId,brandId,connectionId);
    const [existing]=await tx.select().from(channelAnalyticsJobs).where(and(eq(channelAnalyticsJobs.tenantId,tenantId),eq(channelAnalyticsJobs.idempotencyKey,key)));
    if(existing){if(existing.connectionId!==connectionId||existing.brandId!==brandId||existing.requestedBy!==userId)throw new DomainError('CONFLICT',409);return {id:existing.id,status:existing.status};}
    if(!channel.credential||!['ACTIVE','LIMITED'].includes(channel.status))throw new DomainError('SOCIAL_TOKEN_EXPIRED',409);
    if(channel.provider!==configured.name)throw new DomainError('CONFIGURATION_REQUIRED',503);
    const [pending]=await tx.select({id:channelAnalyticsJobs.id}).from(channelAnalyticsJobs).where(and(eq(channelAnalyticsJobs.tenantId,tenantId),eq(channelAnalyticsJobs.connectionId,connectionId),inArray(channelAnalyticsJobs.status,['QUEUED','RUNNING']))).limit(1);if(pending)throw new DomainError('CONFLICT',409);
    const [recent]=await tx.select({id:channelAnalyticsJobs.id}).from(channelAnalyticsJobs).where(and(eq(channelAnalyticsJobs.tenantId,tenantId),eq(channelAnalyticsJobs.connectionId,connectionId),gte(channelAnalyticsJobs.createdAt,new Date(this.now().getTime()-60000)))).limit(1);if(recent)throw new DomainError('RATE_LIMITED',429);
    const [job]=await tx.insert(channelAnalyticsJobs).values({tenantId,brandId,connectionId,credentialVersion:channel.credentialVersion,provider:configured.name,source:configured.source,idempotencyKey:key,requestedBy:userId,correlationId,createdAt:this.now(),nextAttemptAt:this.now(),dispatchAfter:this.now()}).returning();
    await transition(tx,job!,'QUEUED');return {id:job!.id,status:job!.status};
  });}
  async due(){const now=this.now();return this.db.select({tenantId:channelAnalyticsJobs.tenantId,id:channelAnalyticsJobs.id}).from(channelAnalyticsJobs).where(and(lte(channelAnalyticsJobs.dispatchAfter,now),or(and(eq(channelAnalyticsJobs.status,'QUEUED'),lte(channelAnalyticsJobs.nextAttemptAt,now)),and(eq(channelAnalyticsJobs.status,'RUNNING'),lte(channelAnalyticsJobs.leaseExpiresAt,now))))).orderBy(asc(channelAnalyticsJobs.nextAttemptAt)).limit(25);}
  async dispatched(tenantId:string,id:string){await this.db.update(channelAnalyticsJobs).set({dispatchAfter:new Date(this.now().getTime()+10000)}).where(where(tenantId,id));}
  async claim(tenantId:string,id:string){return this.db.transaction(async tx=>{
    await lockTenant(tx,tenantId);const [job]=await tx.select().from(channelAnalyticsJobs).where(where(tenantId,id));if(!job)return null;const now=this.now();
    if(!['QUEUED','RUNNING'].includes(job.status)||job.nextAttemptAt>now||(job.status==='RUNNING'&&job.leaseExpiresAt&&job.leaseExpiresAt>now))return null;
    if(job.attempt>=3||now.getTime()-job.createdAt.getTime()>86400000){await transition(tx,job,'FAILED','PROVIDER_UNAVAILABLE');return null;}
    await transition(tx,job,'RUNNING');const [claimed]=await tx.update(channelAnalyticsJobs).set({attempt:job.attempt+1,leaseToken:randomUUID(),leaseExpiresAt:new Date(now.getTime()+60000),startedAt:now}).where(where(tenantId,id)).returning();return claimed!;
  });}
  private async owned(tx:Transaction,job:Job){const [current]=await tx.select().from(channelAnalyticsJobs).where(where(job.tenantId,job.id));if(!current||current.status!=='RUNNING'||current.leaseToken!==job.leaseToken||!current.leaseExpiresAt||current.leaseExpiresAt<=this.now())throw new DomainError('CONFLICT',409);return current;}
  private async permitted(tx:Transaction,job:Job){
    await authorize(tx,job.requestedBy,job.tenantId,job.brandId,true);const channel=await source(tx,job.tenantId,job.brandId,job.connectionId);
    if(!channel.credential||!['ACTIVE','LIMITED'].includes(channel.status)||channel.credentialVersion!==job.credentialVersion||channel.provider!==job.provider)throw new DomainError('SOCIAL_TOKEN_EXPIRED',409);return channel;
  }
  async prepare(job:Job){return this.db.transaction(async tx=>{await lockTenant(tx,job.tenantId);await this.owned(tx,job);return this.permitted(tx,job);});}
  async complete(job:Job,input:ChannelObservation){
    const parsed=channelObservationSchema.safeParse(input);if(!parsed.success)throw new DomainError('PROVIDER_REJECTED',502);const result=parsed.data,observedAt=new Date(result.observedAt);
    await this.db.transaction(async tx=>{await lockTenant(tx,job.tenantId);const current=await this.owned(tx,job);await this.permitted(tx,current);
      if(!current.startedAt||observedAt<current.startedAt||observedAt.getTime()>this.now().getTime()+5000)throw new DomainError('PROVIDER_REJECTED',502);
      const [metric]=await tx.insert(channelMetrics).values({tenantId:job.tenantId,connectionId:current.connectionId,jobId:job.id,provider:current.provider,source:current.source,memberCount:result.memberCount,observedAt}).returning({id:channelMetrics.id});
      await tx.insert(channelMetricEvidence).values({tenantId:job.tenantId,metricId:metric!.id,payload:{result:result.rawResult}});await transition(tx,current,'SUCCEEDED');
    });
  }
  async fail(job:Job,code:ErrorCode){await this.db.transaction(async tx=>{await lockTenant(tx,job.tenantId);const [current]=await tx.select().from(channelAnalyticsJobs).where(where(job.tenantId,job.id));if(!current||current.status!=='RUNNING'||current.leaseToken!==job.leaseToken)return;
    if(code==='PROVIDER_UNAVAILABLE'&&current.attempt<3){await transition(tx,current,'QUEUED',code);await tx.update(channelAnalyticsJobs).set({nextAttemptAt:new Date(this.now().getTime()+5000*2**current.attempt),leaseToken:null,leaseExpiresAt:null}).where(where(job.tenantId,job.id));}else await transition(tx,current,'FAILED',code);
  });}
}
