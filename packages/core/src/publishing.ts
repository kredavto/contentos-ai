import {z} from 'zod';
import {PublishingRepository} from '@contentos/db';
import {DomainError,ProviderRequestError,publishingApprovalSchema,validateTelegramPublication,telegramVideoByteLimit,type PublishingProvider,type StorageProvider,type OperationContext} from '@contentos/types';
import {CredentialVault} from './credential-vault';
import type {SocialConnection} from './social';
import {avatarConsentPolicies} from './avatars';
export type PublishingConnection={name:string;provider:PublishingProvider}|null;
const uuid=z.uuid();
export class PublishingService{
  constructor(private readonly repository:PublishingRepository,private readonly connection:PublishingConnection,private readonly configured:boolean){}
  async overview(userId:string,tenantId:string,brandId:string){return {jobs:await this.repository.list(userId,uuid.parse(tenantId),uuid.parse(brandId)),configuration:{ready:!!this.connection&&this.configured,provider:this.connection?.name??'disabled'}};}
  approve(userId:string,tenantId:string,brandId:string,input:unknown,correlationId:string){uuid.parse(tenantId);uuid.parse(brandId);const parsed=publishingApprovalSchema.parse(input);if(!this.connection||!this.configured)throw new DomainError('CONFIGURATION_REQUIRED',503);return this.repository.approve(userId,tenantId,brandId,parsed,this.connection.name,avatarConsentPolicies(),correlationId);}
  cancel(userId:string,tenantId:string,brandId:string,id:string){return this.repository.cancel(userId,uuid.parse(tenantId),uuid.parse(brandId),uuid.parse(id));}
}
export class PublishingProcessor{
  constructor(private readonly repository:PublishingRepository,private readonly connection:PublishingConnection,private readonly inspector:SocialConnection,private readonly vault:CredentialVault|null,private readonly storage:StorageProvider|null){}
  async run(tenantId:string,id:string){
    const job=await this.repository.claim(tenantId,id);if(!job)return;
    const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),120000);
    const context:OperationContext={tenantId,internalId:id,idempotencyKey:job.idempotencyKey,correlationId:job.correlationId,signal:abort.signal};
    try{
      if(!this.connection||!this.inspector||!this.vault||this.connection.name!==job.provider||this.inspector.name!==job.provider)throw new DomainError('CONFIGURATION_REQUIRED',503);
      const social=await this.repository.prepare(job,avatarConsentPolicies());
      const credential=this.vault.decrypt(social.credential!,{tenantId,brandId:job.brandId,connectionId:social.id,provider:social.provider});
      const inspected=await this.inspector.provider.inspect(credential,social.reference.externalId,{...context,internalId:social.id});
      if(!inspected.canPublish||inspected.reference.externalId!==social.reference.externalId||inspected.reference.provider!==job.provider)throw new DomainError('NOT_AUTHORIZED',403);
      validateTelegramPublication(job.snapshot,inspected.reference);
      let bytes:Uint8Array|undefined;
      if(job.snapshot.type==='SHORT_VIDEO'){
        if(!this.storage||!job.snapshot.finalKey)throw new DomainError('CONFIGURATION_REQUIRED',503);
        bytes=await this.storage.get(job.snapshot.finalKey,telegramVideoByteLimit,context);
        if(!bytes.length||bytes.length>telegramVideoByteLimit)throw new DomainError('INVALID_MEDIA');
      }
      if(abort.signal.aborted)throw new DomainError('PROVIDER_UNAVAILABLE',503);
      await this.repository.begin(job,avatarConsentPolicies());
      const result=await this.connection.provider.publish({credential,channel:inspected.reference,type:job.snapshot.type,caption:job.snapshot.caption,privacy:job.snapshot.privacy,commentsEnabled:job.snapshot.commentsEnabled,bytes},context);
      await this.repository.complete(job,result);
    }catch(error){await this.repository.fail(job,error instanceof DomainError?error.code:'PROVIDER_UNAVAILABLE',error instanceof ProviderRequestError&&error.definitiveRejection);}
    finally{clearTimeout(timer);}
  }
}
