import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {ProviderKeyRepository} from '@contentos/db';
import {DomainError,providerKeyInputSchema,providerKeyRevisionSchema} from '@contentos/types';
import {CredentialVault} from './credential-vault';
const scope=z.object({userId:z.uuid(),tenantId:z.uuid(),brandId:z.uuid()});
/** Storage foundation; no provider verification or HTTP route is implied by saving a key. */
export class ProviderKeyService {
 constructor(private readonly repository:ProviderKeyRepository,private readonly vault:CredentialVault|null){}
 list(userId:string,tenantId:string,brandId:string){scope.parse({userId,tenantId,brandId});return this.repository.list(userId,tenantId,brandId);}
 async save(userId:string,tenantId:string,brandId:string,raw:unknown,correlationId:string){
  scope.parse({userId,tenantId,brandId});z.uuid().parse(correlationId);const input=providerKeyInputSchema.parse(raw);
  const current=await this.repository.prepare(userId,tenantId,brandId,input.provider);if((current?.revision??null)!==input.revision)throw new DomainError('CONFLICT',409);
  if(!this.vault)throw new DomainError('CONFIGURATION_REQUIRED',503);const id=current?.id??randomUUID();
  const credential=this.vault.encrypt(input.apiKey,{kind:'PROVIDER_KEY',tenantId,brandId,connectionId:id,provider:input.provider});
  return this.repository.save(userId,tenantId,brandId,{id,provider:input.provider,credential,maskedKey:`••••••••${input.apiKey.slice(-4)}`,revision:input.revision},correlationId);
 }
 revoke(userId:string,tenantId:string,brandId:string,id:string,raw:unknown,correlationId:string){scope.parse({userId,tenantId,brandId});return this.repository.revoke(userId,tenantId,brandId,z.uuid().parse(id),providerKeyRevisionSchema.parse(raw).revision,z.uuid().parse(correlationId));}
}
