import {z} from 'zod';
import {ChannelAnalyticsRepository} from '@contentos/db';
import {DomainError,channelAnalyticsRequestSchema,type ChannelAnalyticsProvider} from '@contentos/types';
import {CredentialVault} from './credential-vault';
export type ChannelAnalyticsConnection={name:string;source:'API'|'DEMO';provider:ChannelAnalyticsProvider}|null;
const uuid=z.uuid();
export class ChannelAnalyticsService{
  constructor(private readonly repository:ChannelAnalyticsRepository,private readonly connection:ChannelAnalyticsConnection,private readonly configured:boolean){}
  async overview(userId:string,tenantId:string,brandId:string){return {channels:await this.repository.overview(userId,uuid.parse(tenantId),uuid.parse(brandId)),configuration:{ready:!!this.connection&&this.configured,provider:this.connection?.name??'disabled'}};}
  history(userId:string,tenantId:string,brandId:string,id:string){return this.repository.history(userId,uuid.parse(tenantId),uuid.parse(brandId),uuid.parse(id));}
  request(userId:string,tenantId:string,brandId:string,input:unknown,correlationId:string){uuid.parse(tenantId);uuid.parse(brandId);const parsed=channelAnalyticsRequestSchema.parse(input);if(!this.connection||!this.configured)throw new DomainError('CONFIGURATION_REQUIRED',503);return this.repository.request(userId,tenantId,brandId,parsed.connectionId,parsed.idempotencyKey,this.connection,correlationId);}
}
export class ChannelAnalyticsProcessor{
  constructor(private readonly repository:ChannelAnalyticsRepository,private readonly connection:ChannelAnalyticsConnection,private readonly vault:CredentialVault|null){}
  async run(tenantId:string,id:string){
    const job=await this.repository.claim(tenantId,id);if(!job)return;
    try{
      if(!this.connection||!this.vault||this.connection.name!==job.provider||this.connection.source!==job.source)throw new DomainError('CONFIGURATION_REQUIRED',503);
      const channel=await this.repository.prepare(job),credential=this.vault.decrypt(channel.credential!,{tenantId,brandId:job.brandId,connectionId:job.connectionId,provider:job.provider});
      const result=await this.connection.provider.fetchChannel(channel.reference,credential,{tenantId,internalId:job.id,idempotencyKey:job.idempotencyKey,correlationId:job.correlationId,signal:AbortSignal.timeout(20000)});
      await this.repository.complete(job,result);
    }catch(error){await this.repository.fail(job,error instanceof DomainError?error.code:'PROVIDER_UNAVAILABLE');}
  }
}
