import {z} from 'zod';
import {PublicationAnalyticsRepository} from '@contentos/db';
import {DomainError,publicationAnalyticsRequestSchema,type YouTubeStatisticsProvider,type ErrorReporter} from '@contentos/types';
import type {YouTubeService} from './youtube';
import {reportError} from './error-reporting';
const uuid=z.uuid();
export class PublicationAnalyticsService{
  constructor(private readonly repository:PublicationAnalyticsRepository,private readonly configured:boolean,private readonly source:'API'|'DEMO'='API'){}
  async overview(userId:string,tenantId:string,brandId:string){return {jobs:await this.repository.overview(userId,uuid.parse(tenantId),uuid.parse(brandId)),configuration:{ready:this.configured,source:this.source}};}
  request(userId:string,tenantId:string,brandId:string,input:unknown,correlationId:string){
    uuid.parse(tenantId);uuid.parse(brandId);const parsed=publicationAnalyticsRequestSchema.parse(input);
    if(!this.configured)throw new DomainError('CONFIGURATION_REQUIRED',503);
    return this.repository.request(userId,tenantId,brandId,parsed.publicationId,parsed.idempotencyKey,correlationId,this.source);
  }
}
export class PublicationAnalyticsProcessor{
  constructor(private readonly repository:PublicationAnalyticsRepository,private readonly access:Pick<YouTubeService,'accessForPublication'>,private readonly provider:YouTubeStatisticsProvider|null,private readonly errors?:ErrorReporter,private readonly source:'API'|'DEMO'='API'){}
  async run(tenantId:string,id:string){
    const job=await this.repository.claim(tenantId,id);if(!job)return;
    try{
      if(!this.provider||job.source!==this.source)throw new DomainError('CONFIGURATION_REQUIRED',503);
      const target=await this.repository.prepare(job),context={tenantId,internalId:job.id,idempotencyKey:job.id,correlationId:job.correlationId,signal:AbortSignal.timeout(75000)};
      const access=await this.access.accessForPublication(job.requestedBy,tenantId,job.brandId,job.connectionId,job.credentialVersion,context);
      if(access.channelId!==target.channelId)throw new DomainError('NOT_AUTHORIZED',403);
      await this.repository.prepare(job);context.signal.throwIfAborted();
      const result=await this.provider.statistics(access.accessToken,target.videoId,target.channelId,context);
      if(!result)throw new DomainError('NOT_FOUND',404);
      if(result.reference.provider!=='youtube'||result.reference.internalId!==job.id||result.reference.externalId!==target.videoId||(result.reference.metadata.demo===true)!==(job.source==='DEMO'))throw new DomainError('PROVIDER_REJECTED',502);
      context.signal.throwIfAborted();
      await this.repository.complete(job,{publicationId:job.publicationId,idempotencyKey:job.id,credentialVersion:job.credentialVersion,...target,observedAt:result.observedAt,metrics:result.metrics});
    }catch(error){reportError(this.errors,error,{correlationId:job.correlationId,jobId:id});await this.repository.fail(job,error instanceof DomainError?error.code:'PROVIDER_UNAVAILABLE');}
  }
}
