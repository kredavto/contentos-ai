import {randomUUID,createHash} from 'node:crypto';
import {z} from 'zod';
import {SocialRepository} from '@contentos/db';
import {DomainError,socialConnectSchema,socialRevisionSchema,socialReconnectSchema,type SocialConnectionProvider,type OperationContext} from '@contentos/types';
import {CredentialVault} from './credential-vault';
export type SocialConnection={name:string;provider:SocialConnectionProvider}|null;
const uuid=z.uuid();
export class SocialService{
  constructor(private readonly repository:SocialRepository,private readonly connection:SocialConnection,private readonly vault:CredentialVault|null){}
  async overview(userId:string,tenantId:string,brandId:string){return {connections:await this.repository.list(userId,uuid.parse(tenantId),uuid.parse(brandId)),configuration:{ready:!!this.connection&&!!this.vault,provider:this.connection?.name??'disabled'}};}
  async connect(userId:string,tenantId:string,brandId:string,input:unknown,correlationId:string){
    uuid.parse(tenantId);uuid.parse(brandId);const parsed=socialConnectSchema.parse(input);
    const hash=createHash('sha256').update(JSON.stringify({brandId,...parsed})).digest('hex');const existing=await this.repository.intent(userId,tenantId,brandId,parsed.idempotencyKey,hash);if(existing)return existing;
    if(!this.connection||!this.vault)throw new DomainError('CONFIGURATION_REQUIRED',503);
    const id=randomUUID(),context=this.context(tenantId,id,correlationId);
    const result=await this.connection.provider.inspect(parsed.token,parsed.target,context);
    const credential=this.vault.encrypt(parsed.token,{tenantId,brandId,connectionId:id,provider:this.connection.name});
    return this.repository.create(userId,tenantId,brandId,id,parsed.idempotencyKey,hash,this.connection.name,result,credential,correlationId);
  }
  async refresh(userId:string,tenantId:string,brandId:string,id:string,input:unknown,correlationId:string){
    const revision=socialRevisionSchema.parse(input).revision,row=await this.repository.managed(userId,uuid.parse(tenantId),uuid.parse(brandId),uuid.parse(id));
    if(row.revision!==revision||row.status==='REVOKED'||!row.credential)throw new DomainError('CONFLICT',409);
    if(!this.connection||!this.vault||row.provider!==this.connection.name)throw new DomainError('CONFIGURATION_REQUIRED',503);
    const token=this.vault.decrypt(row.credential,{tenantId,brandId,connectionId:id,provider:row.provider});
    try{const result=await this.connection.provider.inspect(token,row.reference.externalId,this.context(tenantId,id,correlationId));return await this.repository.checked(userId,tenantId,brandId,id,revision,result,null,correlationId);}
    catch(error){if(error instanceof DomainError&&['SOCIAL_TOKEN_EXPIRED','NOT_AUTHORIZED','PROVIDER_UNAVAILABLE','PROVIDER_REJECTED'].includes(error.code))await this.repository.checkFailed(userId,tenantId,brandId,id,revision,error.code,correlationId);throw error;}
  }
  async reconnect(userId:string,tenantId:string,brandId:string,id:string,input:unknown,correlationId:string){
    const parsed=socialReconnectSchema.parse(input),row=await this.repository.managed(userId,uuid.parse(tenantId),uuid.parse(brandId),uuid.parse(id));
    if(row.revision!==parsed.revision)throw new DomainError('CONFLICT',409);
    if(!this.connection||!this.vault||row.provider!==this.connection.name)throw new DomainError('CONFIGURATION_REQUIRED',503);
    const result=await this.connection.provider.inspect(parsed.token,row.reference.externalId,this.context(tenantId,id,correlationId));
    const credential=this.vault.encrypt(parsed.token,{tenantId,brandId,connectionId:id,provider:row.provider});return this.repository.checked(userId,tenantId,brandId,id,parsed.revision,result,credential,correlationId);
  }
  disconnect(userId:string,tenantId:string,brandId:string,id:string,input:unknown,correlationId:string){return this.repository.disconnect(userId,uuid.parse(tenantId),uuid.parse(brandId),uuid.parse(id),socialRevisionSchema.parse(input).revision,correlationId);}
  async rewrap(userId:string,tenantId:string,brandId:string,id:string,input:unknown,correlationId:string){
    const revision=socialRevisionSchema.parse(input).revision,row=await this.repository.managed(userId,uuid.parse(tenantId),uuid.parse(brandId),uuid.parse(id));if(row.revision!==revision||!row.credential)throw new DomainError('CONFLICT',409);if(!this.vault)throw new DomainError('CONFIGURATION_REQUIRED',503);
    return this.repository.rewrap(userId,tenantId,brandId,id,revision,this.vault.rewrap(row.credential,{tenantId,brandId,connectionId:id,provider:row.provider}),correlationId);
  }
  private context(tenantId:string,id:string,correlationId:string):OperationContext{return {tenantId,internalId:id,idempotencyKey:id,correlationId,signal:AbortSignal.timeout(20000)};}
}
