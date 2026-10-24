import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {VoiceRepository,ProviderKeyRepository} from '@contentos/db';
import {DomainError,providerKeyReferenceSchema,type VoiceCatalogProvider} from '@contentos/types';
import {voiceCatalogFromKey} from '@contentos/providers';
import {CredentialVault} from './credential-vault';
const scope=z.object({tenantId:z.uuid(),brandId:z.uuid()});
export class VoiceService {
  constructor(private readonly repository:VoiceRepository,private readonly connection:{provider:VoiceCatalogProvider;name:string}|null,private readonly byok?:{repository:ProviderKeyRepository;vault:CredentialVault|null;catalog?:(key:string)=>VoiceCatalogProvider}){}
  async overview(userId:string,tenantId:string,brandId:string){scope.parse({tenantId,brandId});return {voices:await this.repository.list(userId,tenantId,brandId),configuration:{ready:!!this.connection,byokReady:!!this.byok?.vault}};}
  async refresh(userId:string,tenantId:string,brandId:string,raw:unknown,correlationId:string){
    scope.parse({tenantId,brandId});const {cursor,connection:reference}=z.object({connection:providerKeyReferenceSchema.optional(),cursor:z.string().min(1).max(2048).optional()}).strict().parse(raw);
    await this.repository.authorize(userId,tenantId,brandId,true);
    await this.repository.allowRefresh(tenantId);
    let connection=this.connection;
    if(reference){
      if(!this.byok?.vault)throw new DomainError('CONFIGURATION_REQUIRED',503);
      const key=await this.byok.repository.resolve(userId,tenantId,brandId,reference.id,reference.revision);
      if(key.provider!=='heygen')throw new DomainError('INVALID_INPUT');
      const plaintext=this.byok.vault.decrypt(key.credential!,{kind:'PROVIDER_KEY',tenantId,brandId,connectionId:key.id,provider:key.provider});
      connection={name:'heygen',provider:(this.byok.catalog??voiceCatalogFromKey)(plaintext)};
    }
    if(!connection)throw new DomainError('CONFIGURATION_REQUIRED',503);
    const page=await connection.provider.listPublicVoicePage(cursor,{tenantId,internalId:randomUUID(),idempotencyKey:randomUUID(),correlationId,signal:AbortSignal.timeout(30_000)});
    await this.repository.savePage(userId,tenantId,brandId,connection.name,page.voices,reference);
    return {nextCursor:page.nextCursor};
  }
  select(userId:string,tenantId:string,brandId:string,avatarId:string,raw:unknown,correlationId:string){scope.parse({tenantId,brandId});const {voiceId}=z.object({voiceId:z.uuid()}).strict().parse(raw);return this.repository.select(userId,tenantId,brandId,z.uuid().parse(avatarId),voiceId,correlationId);}
}
