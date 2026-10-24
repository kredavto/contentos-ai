import {z} from 'zod';
import {PublishingRepository,SocialRepository} from '@contentos/db';
import {DomainError,publishingApprovalSchema,youtubePublicationOptionsSchema,type YouTubeCatalogProvider,type OperationContext} from '@contentos/types';
import {YouTubeService} from './youtube';
import {avatarConsentPolicies} from './avatars';
const uuid=z.uuid(),region=z.string().regex(/^[A-Z]{2}$/);
export const youtubeApprovalSchema=publishingApprovalSchema.extend({youtube:youtubePublicationOptionsSchema,regionCode:region});
export class YouTubePublicationService{
  constructor(private readonly repository:PublishingRepository,private readonly social:SocialRepository,private readonly access:YouTubeService,private readonly provider:YouTubeCatalogProvider|null,private readonly configured:boolean,private readonly demo=false){}
  async overview(userId:string,tenantId:string,brandId:string){
    const jobs=(await this.repository.list(userId,uuid.parse(tenantId),uuid.parse(brandId))).filter(job=>job.provider==='youtube');
    return {jobs:jobs.map(job=>this.demo?{...job,reviewUrl:null,url:null}:job),demo:this.demo,configuration:{ready:!!this.provider&&this.configured,status:this.provider&&this.configured?'CONFIGURED' as const:'CONFIGURATION_REQUIRED' as const}};
  }
  async categories(userId:string,tenantId:string,brandId:string,connectionId:string,regionCode:string,correlationId:string){
    uuid.parse(tenantId);uuid.parse(brandId);uuid.parse(connectionId);region.parse(regionCode);
    const row=await this.social.managed(userId,tenantId,brandId,connectionId);
    if(row.provider!=='youtube')throw new DomainError('NOT_FOUND',404);
    if(!this.provider||!this.configured)throw new DomainError('CONFIGURATION_REQUIRED',503);
    const context:OperationContext={tenantId,internalId:connectionId,idempotencyKey:connectionId,correlationId,signal:AbortSignal.timeout(45000)};
    const grant=await this.access.accessForPublication(userId,tenantId,brandId,connectionId,row.credentialVersion,context);
    return this.provider.categories(grant.accessToken,regionCode,context);
  }
  async approve(userId:string,tenantId:string,brandId:string,raw:unknown,correlationId:string){
    uuid.parse(tenantId);uuid.parse(brandId);const input=youtubeApprovalSchema.parse(raw);
    const categories=await this.categories(userId,tenantId,brandId,input.connectionId,input.regionCode,correlationId);
    if(!categories.some(category=>category.id===input.youtube.categoryId))throw new DomainError('INVALID_INPUT');
    return this.repository.approve(userId,tenantId,brandId,input,'youtube',avatarConsentPolicies(),correlationId);
  }
}
