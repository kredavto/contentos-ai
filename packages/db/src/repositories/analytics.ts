import {createHash} from 'node:crypto';
import {and,eq,desc,inArray} from 'drizzle-orm';
import {DomainError,manualMetricsSchema,type ManualMetrics} from '@contentos/types';
import type {Database} from '../index';
import {brands,publications,publishingJobs,publicationMetrics,auditLogs} from '../schema';
import {assertMembership,lockTenant,type Transaction} from './ledger';
async function authorize(tx:Transaction,userId:string,tenantId:string,brandId:string,write=false){
  await assertMembership(tx,userId,tenantId,write?'strategy':'read');
  const [brand]=await tx.select({id:brands.id}).from(brands).where(and(eq(brands.tenantId,tenantId),eq(brands.id,brandId)));
  if(!brand)throw new DomainError('NOT_FOUND',404);
}
const projection={id:publicationMetrics.id,publicationId:publicationMetrics.publicationId,source:publicationMetrics.source,sourceNote:publicationMetrics.sourceNote,metrics:publicationMetrics.metrics,observedAt:publicationMetrics.observedAt,recordedAt:publicationMetrics.recordedAt,recordedBy:publicationMetrics.recordedBy};
async function publication(tx:Transaction,tenantId:string,brandId:string,id:string){
  const [row]=await tx.select({id:publications.id,publishedAt:publications.publishedAt}).from(publications).innerJoin(publishingJobs,and(eq(publishingJobs.tenantId,publications.tenantId),eq(publishingJobs.id,publications.jobId))).where(and(eq(publications.tenantId,tenantId),eq(publishingJobs.brandId,brandId),eq(publications.id,id)));
  if(!row)throw new DomainError('NOT_FOUND',404);return row;
}
export class AnalyticsRepository{
  constructor(private readonly db:Database,private readonly now=()=>new Date()){}
  async overview(userId:string,tenantId:string,brandId:string){return this.db.transaction(async tx=>{
    await authorize(tx,userId,tenantId,brandId);
    const rows=await tx.select({id:publications.id,title:publishingJobs.snapshot,publishedAt:publications.publishedAt,provider:publications.provider,url:publications.url}).from(publications).innerJoin(publishingJobs,and(eq(publishingJobs.tenantId,publications.tenantId),eq(publishingJobs.id,publications.jobId))).where(and(eq(publications.tenantId,tenantId),eq(publishingJobs.brandId,brandId))).orderBy(desc(publications.publishedAt),desc(publications.id)).limit(100);
    const latest=rows.length?await tx.selectDistinctOn([publicationMetrics.publicationId],projection).from(publicationMetrics).where(and(eq(publicationMetrics.tenantId,tenantId),inArray(publicationMetrics.publicationId,rows.map(row=>row.id)))).orderBy(publicationMetrics.publicationId,desc(publicationMetrics.observedAt),desc(publicationMetrics.recordedAt),desc(publicationMetrics.id)):[];
    const byId=new Map(latest.map(row=>[row.publicationId,row]));
    return rows.map(row=>({...row,title:row.title.title,latest:byId.get(row.id)??null}));
  });}
  async history(userId:string,tenantId:string,brandId:string,id:string){return this.db.transaction(async tx=>{await authorize(tx,userId,tenantId,brandId);await publication(tx,tenantId,brandId,id);return tx.select(projection).from(publicationMetrics).where(and(eq(publicationMetrics.tenantId,tenantId),eq(publicationMetrics.publicationId,id))).orderBy(desc(publicationMetrics.observedAt),desc(publicationMetrics.recordedAt),desc(publicationMetrics.id)).limit(100);});}
  async record(userId:string,tenantId:string,brandId:string,input:ManualMetrics,correlationId:string){
    const parsed=manualMetricsSchema.parse(input),observedAt=new Date(parsed.observedAt);
    const inputHash=createHash('sha256').update(JSON.stringify({...parsed,observedAt:observedAt.toISOString()})).digest('hex');
    return this.db.transaction(async tx=>{
      await lockTenant(tx,tenantId);await authorize(tx,userId,tenantId,brandId,true);
      const target=await publication(tx,tenantId,brandId,parsed.publicationId);
      const [existing]=await tx.select().from(publicationMetrics).where(and(eq(publicationMetrics.tenantId,tenantId),eq(publicationMetrics.idempotencyKey,parsed.idempotencyKey)));
      if(existing){if(existing.inputHash!==inputHash||existing.recordedBy!==userId)throw new DomainError('CONFLICT',409);return {id:existing.id};}
      if(observedAt<target.publishedAt||observedAt>this.now())throw new DomainError('INVALID_INPUT');
      const [row]=await tx.insert(publicationMetrics).values({tenantId,publicationId:target.id,source:'MANUAL',sourceNote:parsed.sourceNote,metrics:parsed.metrics,observedAt,recordedBy:userId,idempotencyKey:parsed.idempotencyKey,inputHash}).returning({id:publicationMetrics.id});
      await tx.insert(auditLogs).values({tenantId,userId,action:'PUBLICATION_METRICS_RECORDED',resourceId:row!.id,correlationId,metadata:{publicationId:target.id,source:'MANUAL'}});return row!;
    });
  }
}
