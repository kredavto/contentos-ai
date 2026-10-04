import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {and,eq,desc,gte,lte,gt,inArray,count} from 'drizzle-orm';
import {DomainError,performanceEvidenceSchema,validatePerformanceOutput,strategySchema,recommendationDecisionSchema,type GenerationInput,type GenerationOutput,type RecommendationDecision} from '@contentos/types';
import type {Database} from '../index';
import type {StoredJob} from './jobs';
import {brands,publications,publishingJobs,publicationMetrics,videoProjects,scriptVersions,strategies,strategyVersions,performanceReports,strategyRecommendations,recommendationDecisions,auditLogs} from '../schema';
import {assertMembership,lockTenant,type Transaction} from './ledger';

/** Called under the enqueue tenant lock, after authorization and replay lookup. */
export async function snapshotPerformance(tx:Transaction,tenantId:string,brandId:string,days:number):Promise<NonNullable<GenerationInput['performance']>>{
  if(![7,30,90].includes(days))throw new DomainError('INVALID_INPUT');
  const generatedAt=new Date(),windowStart=new Date(generatedAt.getTime()-days*86400_000);
  const [current]=await tx.select({id:strategies.id,version:strategyVersions.version,content:strategyVersions.content}).from(strategies).innerJoin(strategyVersions,and(eq(strategyVersions.tenantId,strategies.tenantId),eq(strategyVersions.strategyId,strategies.id))).where(and(eq(strategies.tenantId,tenantId),eq(strategies.brandId,brandId))).orderBy(desc(strategyVersions.version)).limit(1);
  if(!current)throw new DomainError('CONFLICT',409);
  const condition=and(eq(publications.tenantId,tenantId),eq(publishingJobs.brandId,brandId),gte(publications.publishedAt,windowStart),lte(publications.publishedAt,generatedAt));
  const join=and(eq(publishingJobs.tenantId,publications.tenantId),eq(publishingJobs.id,publications.jobId));
  const [total]=await tx.select({value:count()}).from(publications).innerJoin(publishingJobs,join).where(condition);
  const rows=await tx.select({id:publications.id,provider:publications.provider,publishedAt:publications.publishedAt,snapshot:publishingJobs.snapshot}).from(publications).innerJoin(publishingJobs,join).where(condition).orderBy(desc(publications.publishedAt),desc(publications.id)).limit(50);
  if(!rows.length)throw new DomainError('INVALID_INPUT');
  const observations=await tx.selectDistinctOn([publicationMetrics.publicationId],{id:publicationMetrics.id,publicationId:publicationMetrics.publicationId,source:publicationMetrics.source,sourceNote:publicationMetrics.sourceNote,observedAt:publicationMetrics.observedAt,metrics:publicationMetrics.metrics}).from(publicationMetrics).where(and(eq(publicationMetrics.tenantId,tenantId),inArray(publicationMetrics.publicationId,rows.map(row=>row.id)),lte(publicationMetrics.observedAt,generatedAt),lte(publicationMetrics.recordedAt,generatedAt))).orderBy(publicationMetrics.publicationId,desc(publicationMetrics.observedAt),desc(publicationMetrics.recordedAt),desc(publicationMetrics.id));
  if(!observations.length)throw new DomainError('INVALID_INPUT');
  const videoIds=rows.flatMap(row=>row.snapshot.videoProjectId?[row.snapshot.videoProjectId]:[]);
  const videos=videoIds.length?await tx.select({id:videoProjects.id,durationMs:videoProjects.durationMs,script:scriptVersions.content}).from(videoProjects).innerJoin(scriptVersions,and(eq(scriptVersions.tenantId,videoProjects.tenantId),eq(scriptVersions.scriptId,videoProjects.scriptId),eq(scriptVersions.version,videoProjects.scriptVersion))).where(and(eq(videoProjects.tenantId,tenantId),eq(videoProjects.brandId,brandId),eq(videoProjects.lifecycle,'ACTIVE'),inArray(videoProjects.id,videoIds))):[];
  const byPublication=new Map(observations.map(row=>[row.publicationId,row])),byVideo=new Map(videos.map(row=>[row.id,row]));
  const evidence=performanceEvidenceSchema.parse({generatedAt:generatedAt.toISOString(),windowStart:windowStart.toISOString(),windowEnd:generatedAt.toISOString(),totalPublications:total!.value,truncated:total!.value>rows.length,publications:rows.map(row=>{
    const observation=byPublication.get(row.id),video=row.snapshot.videoProjectId?byVideo.get(row.snapshot.videoProjectId):undefined;
    return {publicationId:row.id,provider:row.provider,title:row.snapshot.title,format:row.snapshot.type,publishedAt:row.publishedAt.toISOString(),hook:video?.script.hook??null,cta:video?.script.cta??null,durationSeconds:video?.durationMs?video.durationMs/1000:null,observation:observation?{id:observation.id,source:observation.source,sourceNote:observation.sourceNote,observedAt:observation.observedAt.toISOString(),metrics:observation.metrics}:null};
  })});
  return {evidence,strategyId:current.id,strategyVersion:current.version,strategy:strategySchema.parse(current.content)};
}
export async function persistPerformance(tx:Transaction,job:StoredJob,input:GenerationInput,raw:GenerationOutput){
  if(!input.performance)throw new DomainError('INVALID_INPUT');
  const parsed=validatePerformanceOutput(raw,input.performance.evidence);
  if(!parsed.success)throw new DomainError('PROVIDER_REJECTED',502);
  const [report]=await tx.insert(performanceReports).values({tenantId:job.tenantId,brandId:job.brandId,jobId:job.id,strategyId:input.performance.strategyId,strategyVersion:input.performance.strategyVersion,brandRevision:input.brandRevision,evidence:input.performance.evidence,output:parsed.data,provider:job.provider}).returning({id:performanceReports.id});
  await tx.insert(strategyRecommendations).values(parsed.data.recommendations.map((content,ordinal)=>({tenantId:job.tenantId,reportId:report!.id,ordinal,content})));
  return {internalId:report!.id,version:1};
}
async function authorize(tx:Transaction,userId:string,tenantId:string,brandId:string,write=false){
  await assertMembership(tx,userId,tenantId,write?'strategy':'read');
  const [brand]=await tx.select({revision:brands.revision}).from(brands).where(and(eq(brands.tenantId,tenantId),eq(brands.id,brandId))).for('share');
  if(!brand)throw new DomainError('NOT_FOUND',404);return brand;
}
export class PerformanceRepository{
  constructor(private readonly db:Database){}
  async list(userId:string,tenantId:string,brandId:string){return this.db.transaction(async tx=>{
    await authorize(tx,userId,tenantId,brandId);
    const reports=await tx.select().from(performanceReports).where(and(eq(performanceReports.tenantId,tenantId),eq(performanceReports.brandId,brandId))).orderBy(desc(performanceReports.createdAt),desc(performanceReports.id)).limit(20);
    if(!reports.length)return [];
    const recommendations=await tx.select({id:strategyRecommendations.id,reportId:strategyRecommendations.reportId,ordinal:strategyRecommendations.ordinal,content:strategyRecommendations.content,decision:recommendationDecisions.decision,appliedVersion:recommendationDecisions.appliedVersion,decidedAt:recommendationDecisions.createdAt}).from(strategyRecommendations).leftJoin(recommendationDecisions,and(eq(recommendationDecisions.tenantId,strategyRecommendations.tenantId),eq(recommendationDecisions.recommendationId,strategyRecommendations.id))).where(and(eq(strategyRecommendations.tenantId,tenantId),inArray(strategyRecommendations.reportId,reports.map(row=>row.id)))).orderBy(strategyRecommendations.ordinal);
    return reports.map(report=>({...report,recommendations:recommendations.filter(row=>row.reportId===report.id)}));
  });}
  async decide(userId:string,tenantId:string,brandId:string,raw:RecommendationDecision,correlationId:string){
    const input=recommendationDecisionSchema.parse(raw),inputHash=createHash('sha256').update(JSON.stringify({brandId,...input})).digest('hex');
    return this.db.transaction(async tx=>{
      await lockTenant(tx,tenantId);const brand=await authorize(tx,userId,tenantId,brandId,true);
      const [existing]=await tx.select().from(recommendationDecisions).where(and(eq(recommendationDecisions.tenantId,tenantId),eq(recommendationDecisions.idempotencyKey,input.idempotencyKey)));
      if(existing){if(existing.inputHash!==inputHash||existing.actorId!==userId)throw new DomainError('CONFLICT',409);return {id:existing.id,decision:existing.decision,appliedVersion:existing.appliedVersion};}
      const [target]=await tx.select({recommendation:strategyRecommendations,report:performanceReports}).from(strategyRecommendations).innerJoin(performanceReports,and(eq(performanceReports.tenantId,strategyRecommendations.tenantId),eq(performanceReports.id,strategyRecommendations.reportId))).where(and(eq(strategyRecommendations.tenantId,tenantId),eq(strategyRecommendations.id,input.recommendationId),eq(performanceReports.brandId,brandId)));
      if(!target)throw new DomainError('NOT_FOUND',404);
      const [decided]=await tx.select({id:recommendationDecisions.id}).from(recommendationDecisions).where(and(eq(recommendationDecisions.tenantId,tenantId),eq(recommendationDecisions.recommendationId,input.recommendationId)));
      if(decided)throw new DomainError('CONFLICT',409);
      let appliedVersion:number|null=null;
      if(input.decision==='ACCEPTED'){
        const report=target.report;
        if(brand.revision!==report.brandRevision)throw new DomainError('CONFLICT',409);
        const versions=await tx.select().from(strategyVersions).where(and(eq(strategyVersions.tenantId,tenantId),eq(strategyVersions.strategyId,report.strategyId),gte(strategyVersions.version,report.strategyVersion))).orderBy(desc(strategyVersions.version));
        const latest=versions[0],base=versions.find(row=>row.version===report.strategyVersion);
        if(!latest||!base||latest.version!==input.expectedVersion)throw new DomainError('CONFLICT',409);
        // Only disjoint, explicitly accepted patches from this same report may intervene.
        const accepted=await tx.select({version:recommendationDecisions.appliedVersion}).from(recommendationDecisions).innerJoin(strategyRecommendations,and(eq(strategyRecommendations.tenantId,recommendationDecisions.tenantId),eq(strategyRecommendations.id,recommendationDecisions.recommendationId))).where(and(eq(recommendationDecisions.tenantId,tenantId),eq(strategyRecommendations.reportId,report.id),eq(recommendationDecisions.decision,'ACCEPTED'),gt(recommendationDecisions.appliedVersion,report.strategyVersion)));
        const allowed=new Set(accepted.map(row=>row.version));
        if(versions.some(row=>row.version>report.strategyVersion&&!allowed.has(row.version)))throw new DomainError('CONFLICT',409);
        const patch=target.recommendation.content.patch;
        if(!isDeepStrictEqual(latest.content[patch.field],base.content[patch.field]))throw new DomainError('CONFLICT',409);
        const content=strategySchema.parse({...latest.content,[patch.field]:patch.value});
        appliedVersion=latest.version+1;
        await tx.insert(strategyVersions).values({tenantId,strategyId:report.strategyId,version:appliedVersion,jobId:null,createdBy:userId,content});
      }
      const [saved]=await tx.insert(recommendationDecisions).values({tenantId,recommendationId:input.recommendationId,decision:input.decision,strategyId:target.report.strategyId,appliedVersion,actorId:userId,idempotencyKey:input.idempotencyKey,inputHash,correlationId}).returning({id:recommendationDecisions.id,decision:recommendationDecisions.decision,appliedVersion:recommendationDecisions.appliedVersion});
      await tx.insert(auditLogs).values({tenantId,userId,action:`STRATEGY_RECOMMENDATION_${input.decision}`,resourceId:input.recommendationId,correlationId,metadata:{reportId:target.report.id,appliedVersion}});return saved!;
    });
  }
}
