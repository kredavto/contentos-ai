import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {ProviderKeyRepository} from '@contentos/db';
import {DomainError,providerKeyInputSchema,providerKeyRevisionSchema,providerKeyReferenceSchema,type OperationContext} from '@contentos/types';
import {verifyHeyGenKey} from '@contentos/providers';
import {CredentialVault} from './credential-vault';
const scope=z.object({userId:z.uuid(),tenantId:z.uuid(),brandId:z.uuid()});
/** Saving an encrypted key does not imply provider verification. */
export class ProviderKeyService {
 constructor(private readonly repository:ProviderKeyRepository,private readonly vault:CredentialVault|null,private readonly verifier:(key:string,context:OperationContext)=>Promise<void>=verifyHeyGenKey){}
 list(userId:string,tenantId:string,brandId:string){scope.parse({userId,tenantId,brandId});return this.repository.list(userId,tenantId,brandId);}
 async overview(userId:string,tenantId:string,brandId:string){return {keys:await this.list(userId,tenantId,brandId),configuration:{ready:!!this.vault}};}
 async verify(userId:string,tenantId:string,brandId:string,id:string,raw:unknown,correlationId:string){
  scope.parse({userId,tenantId,brandId});z.uuid().parse(correlationId);const reference=providerKeyReferenceSchema.parse({id:z.uuid().parse(id),...providerKeyRevisionSchema.parse(raw)});
  const key=await this.repository.verificationInput(userId,tenantId,brandId,reference);
  if(key.provider!=='heygen')throw new DomainError('INVALID_INPUT');
  if(!this.vault)throw new DomainError('CONFIGURATION_REQUIRED',503);
  await this.repository.allowVerification(tenantId);
  const plaintext=this.vault.decrypt(key.credential!,{kind:'PROVIDER_KEY',tenantId,brandId,connectionId:key.id,provider:key.provider});
  await this.verifier(plaintext,{tenantId,internalId:key.id,idempotencyKey:randomUUID(),correlationId,signal:AbortSignal.timeout(30_000)});
  await this.repository.completeVerification(userId,tenantId,brandId,reference,correlationId);
  return {accepted:true as const};
 }
 async save(userId:string,tenantId:string,brandId:string,raw:unknown,correlationId:string){
  scope.parse({userId,tenantId,brandId});z.uuid().parse(correlationId);const input=providerKeyInputSchema.parse(raw);
  const current=await this.repository.prepare(userId,tenantId,brandId,input.provider);if((current?.revision??null)!==input.revision)throw new DomainError('CONFLICT',409);
  if(!this.vault)throw new DomainError('CONFIGURATION_REQUIRED',503);const id=current?.id??randomUUID();
  const credential=this.vault.encrypt(input.apiKey,{kind:'PROVIDER_KEY',tenantId,brandId,connectionId:id,provider:input.provider});
  return this.repository.save(userId,tenantId,brandId,{id,provider:input.provider,credential,maskedKey:`••••••••${input.apiKey.slice(-4)}`,revision:input.revision},correlationId);
 }
 revoke(userId:string,tenantId:string,brandId:string,id:string,raw:unknown,correlationId:string){scope.parse({userId,tenantId,brandId});return this.repository.revoke(userId,tenantId,brandId,z.uuid().parse(id),providerKeyRevisionSchema.parse(raw).revision,z.uuid().parse(correlationId));}
}
