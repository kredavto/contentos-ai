import { z } from 'zod';
import { JobRepository, BrandRepository, LedgerRepository, ContentRepository } from '@contentos/db';
import { DomainError, postHistoryQuerySchema, generationRequestSchema, carouselHistoryQuerySchema, carouselLifecycleSchema, carouselExportQuerySchema, carouselEditSchema, postEditSchema, scriptSchema, type GenerationInput } from '@contentos/types';
const id = z.uuid();
export class GenerationService {
  constructor(private readonly jobs:JobRepository,private readonly brands:BrandRepository,private readonly ledger:LedgerRepository,private readonly content:ContentRepository,private readonly configuration:{provider:string;model:string;ready:boolean;analyticsAI?:boolean}) {}
  async overview(userId:string,tenantId:string,brandId:string) {
    id.parse(tenantId); id.parse(brandId);
    const jobs = await this.jobs.list(userId,tenantId,brandId);
    const content = await this.content.overview(userId,tenantId,brandId);
    return {...content,jobs,usage:await this.ledger.overview(userId,tenantId),configuration:this.configuration};
  }
  async enqueue(userId:string,tenantId:string,brandId:string,raw:unknown,correlationId:string) {
    id.parse(tenantId); id.parse(brandId); const request = generationRequestSchema.parse(raw);
    if(request.type==='OPTIMIZE_STRATEGY'&&!this.configuration.analyticsAI)throw new DomainError('CONFIGURATION_REQUIRED',503);
    if((request.type==='OPTIMIZE_STRATEGY')!==(request.options.analysisDays!==undefined))throw new DomainError('INVALID_INPUT');
    if ((request.type==='DRAFT_COMMENT_REPLY')!==(request.options.commentReply!==undefined))throw new DomainError('INVALID_INPUT');
    if(request.type==='DRAFT_COMMENT_REPLY'&&(request.options.scriptId||request.options.ideaId||request.options.revision!==undefined||request.options.edit!=='GENERATE'||request.options.analysisDays!==undefined))throw new DomainError('INVALID_INPUT');
    if (!this.configuration.ready) throw new DomainError('CONFIGURATION_REQUIRED',503);
    if (!['GENERATE_SCRIPT', 'REVIEW_SCRIPT'].includes(request.type) && (request.options.scriptId || request.options.ideaId)) throw new DomainError('INVALID_INPUT');
    if (request.options.edit !== 'GENERATE' && !request.options.scriptId) throw new DomainError('INVALID_INPUT');
    if (['GENERATE_POST','GENERATE_CAROUSEL'].includes(request.type) && (request.options.revision !== undefined || request.options.edit !== 'GENERATE')) throw new DomainError('INVALID_INPUT');
    if (request.type === 'REVIEW_SCRIPT' && (!request.options.scriptId || !request.options.revision || request.options.ideaId || request.options.edit !== 'GENERATE')) throw new DomainError('INVALID_INPUT');
    const brain = await this.brands.getBrandBrain(userId,tenantId,brandId);
    let previousScript: GenerationInput['previousScript'];
    if (request.options.scriptId) {
      const versions = await this.content.history(userId,tenantId,brandId,request.options.scriptId);
      previousScript = versions.find(version=>version.version === request.options.revision)?.content;
      if (!previousScript) throw new DomainError('CONFLICT',409);
    }
    const input:GenerationInput = {brain:brain.data,brandRevision:brain.brand.revision,options:request.options,...(previousScript?{previousScript}:{})};
    const job = await this.jobs.enqueue(userId,tenantId,brandId,request.type,input,request.idempotencyKey,this.configuration.provider,this.configuration.model,correlationId);
    return {id:job.id,status:job.status};
  }
  postHistory(userId:string,tenantId:string,brandId:string,postId:string) { return this.content.postHistory(userId,id.parse(tenantId),id.parse(brandId),id.parse(postId)); }
  postHistoryPage(userId:string,tenantId:string,brandId:string,postId:string,raw:unknown){return this.content.postHistoryPage(userId,id.parse(tenantId),id.parse(brandId),id.parse(postId),postHistoryQuerySchema.parse(raw));}
  editPost(userId:string,tenantId:string,brandId:string,postId:string,raw:unknown,correlationId:string) { return this.content.editPost(userId,id.parse(tenantId),id.parse(brandId),id.parse(postId),postEditSchema.parse(raw),correlationId); }
  carouselHistory(userId:string,tenantId:string,brandId:string,carouselId:string) { return this.content.carouselHistory(userId,id.parse(tenantId),id.parse(brandId),id.parse(carouselId)); }
  carouselHistoryPage(userId:string,tenantId:string,brandId:string,carouselId:string,raw:unknown){return this.content.carouselHistoryPage(userId,id.parse(tenantId),id.parse(brandId),id.parse(carouselId),carouselHistoryQuerySchema.parse(raw));}
  authorizeCarouselExport(userId:string,tenantId:string,brandId:string,carouselId:string,raw:unknown){return this.content.authorizeCarouselExport(userId,id.parse(tenantId),id.parse(brandId),id.parse(carouselId),carouselExportQuerySchema.parse(raw));}
  setCarouselArchived(userId:string,tenantId:string,brandId:string,carouselId:string,raw:unknown,correlationId:string){return this.content.setCarouselArchived(userId,id.parse(tenantId),id.parse(brandId),id.parse(carouselId),carouselLifecycleSchema.parse(raw),correlationId);}
  editCarousel(userId:string,tenantId:string,brandId:string,carouselId:string,raw:unknown,correlationId:string) { return this.content.editCarousel(userId,id.parse(tenantId),id.parse(brandId),id.parse(carouselId),carouselEditSchema.parse(raw),correlationId); }
  grantTrial(userId:string,tenantId:string,correlationId:string) { return this.ledger.grantTrial(userId,id.parse(tenantId),correlationId); }
  currentIdea(userId:string,tenantId:string,brandId:string,ideaId:string) {return this.content.currentIdea(userId,id.parse(tenantId),id.parse(brandId),id.parse(ideaId));}
  currentScript(userId:string,tenantId:string,brandId:string,scriptId:string) {return this.content.currentScript(userId,id.parse(tenantId),id.parse(brandId),id.parse(scriptId));}
  history(userId:string,tenantId:string,brandId:string,scriptId:string) {return this.content.history(userId,id.parse(tenantId),id.parse(brandId),id.parse(scriptId));}
  editScript(userId:string,tenantId:string,brandId:string,scriptId:string,raw:unknown,correlationId:string) {
    const input = z.object({revision:z.number().int().positive(),content:scriptSchema.nullable()}).strict().parse(raw);
    return this.content.editScript(userId,id.parse(tenantId),id.parse(brandId),id.parse(scriptId),input.revision,input.content,correlationId);
  }
}
