import type {ErrorReporter} from '@contentos/types';
import {reportError} from './error-reporting';
import {avatarFromKey,type HeyGenCircuitScope} from '@contentos/providers';
import {CredentialVault} from './credential-vault';
import type {EncryptedCredential} from '@contentos/types';
import { z } from 'zod';
import { AvatarRepository,AICallRepository,JobRepository,type Database,type StoredJob } from '@contentos/db';
import { DomainError,ProviderRequestError,avatarRequestSchema,type AvatarProvider,type StorageProvider,type OperationContext } from '@contentos/types';
import { consentPolicy } from './consent';
export const avatarConsentPolicies=()=>[consentPolicy('OWN_LIKENESS'),consentPolicy('THIRD_PARTY_LIKENESS'),consentPolicy('CROSS_BORDER_PROCESSING')];
export type AvatarConnection={provider:AvatarProvider;name:string}|null;
export type AvatarByok={vault:CredentialVault|null;provider?:(key:string,scope?:HeyGenCircuitScope)=>AvatarProvider};
function boundConnection(key:{id:string;tenantId:string;brandId:string;revision:number;provider:string;credential:EncryptedCredential|null},byok?:AvatarByok){
 if(!byok?.vault||!key.credential||key.provider!=='heygen')throw new DomainError('CONFIGURATION_REQUIRED',503);
 const plaintext=byok.vault.decrypt(key.credential,{kind:'PROVIDER_KEY',tenantId:key.tenantId,brandId:key.brandId,connectionId:key.id,provider:'heygen'});
 return {name:'heygen',provider:(byok.provider??avatarFromKey)(plaintext,{tenantId:key.tenantId,providerKeyId:key.id,revision:key.revision})};
}
const uuid=z.uuid();
const contextFor=(job:StoredJob,signal:AbortSignal):OperationContext=>({tenantId:job.tenantId,internalId:job.id,idempotencyKey:job.idempotencyKey,correlationId:job.correlationId,signal});
export class AvatarService {
  constructor(private readonly repository:AvatarRepository,private readonly connection:AvatarConnection,private readonly storage:StorageProvider|null,private readonly enabled:boolean,private readonly byok?:AvatarByok){}
  async overview(userId:string,tenantId:string,brandId:string){
    const looks=await this.repository.list(userId,uuid.parse(tenantId),uuid.parse(brandId),avatarConsentPolicies());
    return {looks,configuration:{ready:this.enabled&&!!this.connection&&!!this.storage,provider:this.connection?.name??'disabled',byokReady:this.enabled&&!!this.storage&&!!this.byok?.vault,connections:await this.repository.generationReferences(userId,tenantId,brandId)}};
  }
  async create(userId:string,tenantId:string,brandId:string,raw:unknown,correlationId:string){
    const input=avatarRequestSchema.parse(raw);
    if(!this.enabled||!this.storage||(input.connection?!this.byok?.vault:!this.connection))throw new DomainError('CONFIGURATION_REQUIRED',503);
    return this.repository.enqueue(userId,uuid.parse(tenantId),uuid.parse(brandId),input,avatarConsentPolicies(),input.connection?'heygen':this.connection!.name,correlationId);
  }
  delete(userId:string,tenantId:string,brandId:string,id:string,correlationId:string){return this.repository.delete(userId,uuid.parse(tenantId),uuid.parse(brandId),uuid.parse(id),correlationId);}
  resume(userId:string,tenantId:string,brandId:string,id:string,correlationId:string){return this.repository.resume(userId,uuid.parse(tenantId),uuid.parse(brandId),uuid.parse(id),avatarConsentPolicies(),correlationId);}
  async cleanupOne(){
    let avatar=this.connection?await this.repository.claimDeletion(this.connection.name):null;
    if(!avatar&&this.byok)avatar=await this.repository.claimDeletion('heygen',true);
    if(!avatar)return false;
    let succeeded=false;
    try{
      if(avatar.reference){
        const connection=avatar.providerKeyId?boundConnection(await this.repository.deletionKey(avatar),this.byok):this.connection;
        if(!connection)throw new DomainError('CONFIGURATION_REQUIRED',503);
        await connection.provider.delete(avatar.reference,{tenantId:avatar.tenantId,internalId:avatar.id,idempotencyKey:avatar.id,correlationId:avatar.correlationId,signal:AbortSignal.timeout(60_000)});
      }
      succeeded=true;
    }catch{/* Retain pending deletion on unavailable/revoked credentials; never switch accounts. */}
    await this.repository.finishDeletion(avatar,succeeded);return true;
  }
}
export class AvatarProcessor {
  private readonly repository:AvatarRepository;
  private readonly jobs:JobRepository;
  constructor(private readonly db:Database,private readonly connection:AvatarConnection,private readonly storage:StorageProvider|null,private readonly enabled:boolean,private readonly errors?:ErrorReporter,private readonly byok?:AvatarByok){this.repository=new AvatarRepository(db);this.jobs=new JobRepository(db);}
  async run(tenantId:string,id:string){
    const job=await this.repository.claim(tenantId,id);if(!job?.leaseToken)return;
    const abort=new AbortController();const context=contextFor(job,abort.signal);
    const heartbeat=setInterval(()=>{void this.jobs.heartbeat(tenantId,id,job.leaseToken!).then(owned=>{if(!owned)abort.abort();}).catch(()=>abort.abort());},30_000);
    const calls=new AICallRepository(this.db,job);
    let polling=false;
    try{
      let data=await this.repository.prepare(job,avatarConsentPolicies());
      const connection=data.key?boundConnection(data.key,this.byok):this.connection;
      if(!connection||connection.name!==job.provider)throw new DomainError('CONFIGURATION_REQUIRED',503);
      if(!data.look.reference){
        if(!this.enabled||!this.storage||data.asset.provider!=='s3')throw new DomainError('CONFIGURATION_REQUIRED',503);
        const photoUrl=await this.storage.signedDownload(data.asset.storageKey,900,context);
        await calls.started(1,job.provider,'photo-avatar');
        data=await this.repository.prepare(job,avatarConsentPolicies(),true);
        abort.signal.throwIfAborted();
        const started=Date.now();
        let reference;
        try{reference=await connection.provider.create({name:data.look.name,photoUrl,...(data.avatar.reference?{groupReference:data.avatar.reference}:{})},context);}
        catch(error){await calls.failed(1,error instanceof ProviderRequestError&&error.definitiveRejection?error.code:'PROVIDER_UNAVAILABLE',Date.now()-started);throw error;}
        // Persist the remote reference before telemetry or lease-dependent work.
        await this.repository.submitted(job,reference);
        await calls.succeeded(1,{json:reference,usage:{model:'photo-avatar',inputUnits:1,outputUnits:1,costMicrounits:null,currency:'USD'}},Date.now()-started);
        await this.repository.wait(job);
      }else{
        polling=true;
        const result=await connection.provider.status(data.look.reference,context);
        if(result.status==='READY')await this.repository.complete(job,avatarConsentPolicies());
        else if(result.status==='FAILED'){reportError(this.errors,new DomainError('PROVIDER_REJECTED'),{correlationId:job.correlationId,jobId:id});await this.repository.fail(job,'PROVIDER_REJECTED');}
        else await this.repository.wait(job);
      }
    }catch(error){
      const code=polling&&error instanceof DomainError&&error.code==='PROVIDER_REJECTED'?'RECONCILIATION_REQUIRED':error instanceof DomainError?error.code:'PROVIDER_UNAVAILABLE';
      reportError(this.errors,error,{correlationId:job.correlationId,jobId:id,code});
      try{await this.repository.fail(job,code,error instanceof ProviderRequestError&&error.definitiveRejection);}
      catch(failure){if(!(failure instanceof DomainError&&failure.code==='CONFLICT'))throw failure;}
      console.log(JSON.stringify({event:'avatar_job_error',jobId:job.id,correlationId:job.correlationId,code}));
    }finally{clearInterval(heartbeat);}
  }
}
