import {randomUUID} from 'node:crypto';
import {and,eq,inArray,asc,desc,lte,gte,or} from 'drizzle-orm';
import {DomainError,youtubeMetricsObservationSchema,publicationAnalyticsRequestSchema,type YouTubeMetricsObservation,type ChannelAnalyticsState,type ErrorCode} from '@contentos/types';
import type {Database} from '../index';
import {brands,socialConnections,publications,publishingJobs,publicationAnalyticsJobs,auditLogs} from '../schema';
import {assertMembership,lockTenant,type Transaction} from './ledger';
import {recordYouTubeObservation} from './analytics';
type Job=typeof publicationAnalyticsJobs.$inferSelect;
const where=(tenantId:string,id:string)=>and(eq(publicationAnalyticsJobs.tenantId,tenantId),eq(publicationAnalyticsJobs.id,id));
const projection={id:publicationAnalyticsJobs.id,publicationId:publicationAnalyticsJobs.publicationId,status:publicationAnalyticsJobs.status,attempt:publicationAnalyticsJobs.attempt,errorCode:publicationAnalyticsJobs.errorCode,createdAt:publicationAnalyticsJobs.createdAt,nextAttemptAt:publicationAnalyticsJobs.nextAttemptAt};
async function authorize(tx:Transaction,userId:string,tenantId:string,brandId:string,write=false){
  await assertMembership(tx,userId,tenantId,write?'strategy':'read');
  const [brand]=await tx.select({id:brands.id}).from(brands).where(and(eq(brands.tenantId,tenantId),eq(brands.id,brandId)));
  if(!brand)throw new DomainError('NOT_FOUND',404);
}
async function target(tx:Transaction,tenantId:string,brandId:string,publicationId:string,source:'API'|'DEMO'){
  const [row]=await tx.select({publication:publications,connection:socialConnections}).from(publications)
    .innerJoin(publishingJobs,and(eq(publishingJobs.tenantId,publications.tenantId),eq(publishingJobs.id,publications.jobId)))
    .innerJoin(socialConnections,and(eq(socialConnections.tenantId,publishingJobs.tenantId),eq(socialConnections.id,publishingJobs.connectionId)))
    .where(and(eq(publications.tenantId,tenantId),eq(publications.id,publicationId),eq(publishingJobs.brandId,brandId),eq(socialConnections.brandId,brandId)));
  if(!row)throw new DomainError('NOT_FOUND',404);
  if(row.publication.provider!=='youtube'||row.publication.reference.provider!=='youtube'||row.connection.provider!=='youtube'||row.connection.reference.provider!=='youtube'||(row.publication.reference.metadata.demo===true)!==(source==='DEMO')||(row.connection.reference.metadata.demo===true)!==(source==='DEMO'))throw new DomainError('CONFIGURATION_REQUIRED',503);
  if(row.connection.status!=='ACTIVE'||!row.connection.credential)throw new DomainError('SOCIAL_TOKEN_EXPIRED',409);
  return row;
}
export class PublicationAnalyticsRepository{
  constructor(private readonly db:Database,private readonly now=()=>new Date()){}
  private async transition(tx:Transaction,job:Job,status:ChannelAnalyticsState,code:ErrorCode|null=null){
    const terminal=['SUCCEEDED','FAILED','CANCELLED'].includes(status);
    await tx.update(publicationAnalyticsJobs).set({status,errorCode:code,...(terminal?{finishedAt:this.now(),leaseToken:null,leaseExpiresAt:null}:{})}).where(where(job.tenantId,job.id));
    await tx.insert(auditLogs).values({tenantId:job.tenantId,userId:job.requestedBy,action:`PUBLICATION_ANALYTICS_${status}`,resourceId:job.id,correlationId:job.correlationId,metadata:{from:job.status,to:status,attempt:job.attempt,code}});
  }
  async overview(userId:string,tenantId:string,brandId:string){return this.db.transaction(async tx=>{
    await authorize(tx,userId,tenantId,brandId);
    const visible=tx.select({id:publications.id}).from(publications).innerJoin(publishingJobs,and(eq(publishingJobs.tenantId,publications.tenantId),eq(publishingJobs.id,publications.jobId))).where(and(eq(publications.tenantId,tenantId),eq(publishingJobs.brandId,brandId))).orderBy(desc(publications.publishedAt),desc(publications.id)).limit(100);
    return tx.selectDistinctOn([publicationAnalyticsJobs.publicationId],projection).from(publicationAnalyticsJobs).where(and(eq(publicationAnalyticsJobs.tenantId,tenantId),eq(publicationAnalyticsJobs.brandId,brandId),inArray(publicationAnalyticsJobs.publicationId,visible))).orderBy(publicationAnalyticsJobs.publicationId,desc(publicationAnalyticsJobs.createdAt),desc(publicationAnalyticsJobs.id));
  });}
  async request(userId:string,tenantId:string,brandId:string,publicationId:string,key:string,correlationId:string,source:'API'|'DEMO'='API'){
    publicationAnalyticsRequestSchema.parse({publicationId,idempotencyKey:key});
    return this.db.transaction(async tx=>{
      await lockTenant(tx,tenantId);await authorize(tx,userId,tenantId,brandId,true);
      const row=await target(tx,tenantId,brandId,publicationId,source);
      const [existing]=await tx.select().from(publicationAnalyticsJobs).where(and(eq(publicationAnalyticsJobs.tenantId,tenantId),eq(publicationAnalyticsJobs.idempotencyKey,key)));
      if(existing){if(existing.publicationId!==publicationId||existing.brandId!==brandId||existing.requestedBy!==userId||existing.source!==source)throw new DomainError('CONFLICT',409);return {id:existing.id,status:existing.status};}
      const pending=await tx.select({publicationId:publicationAnalyticsJobs.publicationId}).from(publicationAnalyticsJobs).where(and(eq(publicationAnalyticsJobs.tenantId,tenantId),inArray(publicationAnalyticsJobs.status,['QUEUED','RUNNING']))).limit(26);
      if(pending.some(job=>job.publicationId===publicationId))throw new DomainError('CONFLICT',409);
      if(pending.length>=25)throw new DomainError('RATE_LIMITED',429);
      const [recent]=await tx.select({id:publicationAnalyticsJobs.id}).from(publicationAnalyticsJobs).where(and(eq(publicationAnalyticsJobs.tenantId,tenantId),eq(publicationAnalyticsJobs.publicationId,publicationId),gte(publicationAnalyticsJobs.createdAt,new Date(this.now().getTime()-60000)))).limit(1);
      if(recent)throw new DomainError('RATE_LIMITED',429);
      const [job]=await tx.insert(publicationAnalyticsJobs).values({tenantId,brandId,publicationId,connectionId:row.connection.id,credentialVersion:row.connection.credentialVersion,provider:'youtube',source,idempotencyKey:key,requestedBy:userId,correlationId,createdAt:this.now(),nextAttemptAt:this.now(),dispatchAfter:this.now()}).returning();
      await this.transition(tx,job!,'QUEUED');return {id:job!.id,status:job!.status};
    });
  }
  async due(){const now=this.now();return this.db.select({tenantId:publicationAnalyticsJobs.tenantId,id:publicationAnalyticsJobs.id}).from(publicationAnalyticsJobs).where(and(lte(publicationAnalyticsJobs.dispatchAfter,now),or(and(eq(publicationAnalyticsJobs.status,'QUEUED'),lte(publicationAnalyticsJobs.nextAttemptAt,now)),and(eq(publicationAnalyticsJobs.status,'RUNNING'),lte(publicationAnalyticsJobs.leaseExpiresAt,now))))).orderBy(asc(publicationAnalyticsJobs.nextAttemptAt)).limit(25);}
  async dispatched(tenantId:string,id:string){await this.db.update(publicationAnalyticsJobs).set({dispatchAfter:new Date(this.now().getTime()+10000)}).where(where(tenantId,id));}
  async claim(tenantId:string,id:string){return this.db.transaction(async tx=>{
    await lockTenant(tx,tenantId);const [job]=await tx.select().from(publicationAnalyticsJobs).where(where(tenantId,id));if(!job)return null;const now=this.now();
    if(!['QUEUED','RUNNING'].includes(job.status)||job.nextAttemptAt>now||(job.status==='RUNNING'&&job.leaseExpiresAt&&job.leaseExpiresAt>now))return null;
    if(job.attempt>=3||now.getTime()-job.createdAt.getTime()>86400000){await this.transition(tx,job,'FAILED','PROVIDER_UNAVAILABLE');return null;}
    const [claimed]=await tx.update(publicationAnalyticsJobs).set({attempt:job.attempt+1,leaseToken:randomUUID(),leaseExpiresAt:new Date(now.getTime()+120000),startedAt:now}).where(where(tenantId,id)).returning();
    await this.transition(tx,claimed!,'RUNNING');return {...claimed!,status:'RUNNING' as const};
  });}
  private async owned(tx:Transaction,job:Job){const [current]=await tx.select().from(publicationAnalyticsJobs).where(where(job.tenantId,job.id));if(!current||current.status!=='RUNNING'||current.leaseToken!==job.leaseToken||!current.leaseExpiresAt||current.leaseExpiresAt<=this.now())throw new DomainError('CONFLICT',409);return current;}
  private async permitted(tx:Transaction,job:Job){
    await authorize(tx,job.requestedBy,job.tenantId,job.brandId,true);const row=await target(tx,job.tenantId,job.brandId,job.publicationId,job.source);
    if(row.connection.id!==job.connectionId||row.connection.credentialVersion!==job.credentialVersion)throw new DomainError('SOCIAL_TOKEN_EXPIRED',409);
    return {videoId:row.publication.reference.externalId,channelId:row.connection.reference.externalId};
  }
  async prepare(job:Job){return this.db.transaction(async tx=>{await lockTenant(tx,job.tenantId);const current=await this.owned(tx,job);return this.permitted(tx,current);});}
  async complete(job:Job,input:YouTubeMetricsObservation){
    const parsed=youtubeMetricsObservationSchema.safeParse(input);if(!parsed.success)throw new DomainError('PROVIDER_REJECTED',502);
    await this.db.transaction(async tx=>{
      await lockTenant(tx,job.tenantId);const current=await this.owned(tx,job);const remote=await this.permitted(tx,current),result=parsed.data;
      if(result.publicationId!==current.publicationId||result.idempotencyKey!==current.id||result.credentialVersion!==current.credentialVersion||result.videoId!==remote.videoId||result.channelId!==remote.channelId||!current.startedAt||new Date(result.observedAt)<current.startedAt)throw new DomainError('PROVIDER_REJECTED',502);
      await recordYouTubeObservation(tx,current.requestedBy,current.tenantId,current.brandId,result,current.correlationId,this.now(),current.source);
      await this.transition(tx,current,'SUCCEEDED');
    });
  }
  async fail(job:Job,code:ErrorCode){await this.db.transaction(async tx=>{
    await lockTenant(tx,job.tenantId);const [current]=await tx.select().from(publicationAnalyticsJobs).where(where(job.tenantId,job.id));
    if(!current||current.status!=='RUNNING'||current.leaseToken!==job.leaseToken||!current.leaseExpiresAt||current.leaseExpiresAt<=this.now())return;
    if(code==='PROVIDER_UNAVAILABLE'&&current.attempt<3){await this.transition(tx,current,'QUEUED',code);await tx.update(publicationAnalyticsJobs).set({nextAttemptAt:new Date(this.now().getTime()+5000*2**current.attempt),leaseToken:null,leaseExpiresAt:null}).where(where(job.tenantId,job.id));}
    else await this.transition(tx,current,['NOT_AUTHORIZED','NOT_FOUND','SOCIAL_TOKEN_EXPIRED'].includes(code)?'CANCELLED':'FAILED',code);
  });}
}
