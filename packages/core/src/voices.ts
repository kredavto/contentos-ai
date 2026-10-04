import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {VoiceRepository} from '@contentos/db';
import {DomainError,type VoiceCatalogProvider} from '@contentos/types';
const scope=z.object({tenantId:z.uuid(),brandId:z.uuid()});
export class VoiceService {
  constructor(private readonly repository:VoiceRepository,private readonly connection:{provider:VoiceCatalogProvider;name:string}|null){}
  async overview(userId:string,tenantId:string,brandId:string){scope.parse({tenantId,brandId});return {voices:await this.repository.list(userId,tenantId,brandId),configuration:{ready:!!this.connection}};}
  async refresh(userId:string,tenantId:string,brandId:string,raw:unknown,correlationId:string){
    scope.parse({tenantId,brandId});const {cursor}=z.object({cursor:z.string().min(1).max(2048).optional()}).strict().parse(raw);
    await this.repository.authorize(userId,tenantId,brandId,true);
    if(!this.connection)throw new DomainError('CONFIGURATION_REQUIRED',503);
    await this.repository.allowRefresh(tenantId);
    const page=await this.connection.provider.listPublicVoicePage(cursor,{tenantId,internalId:randomUUID(),idempotencyKey:randomUUID(),correlationId,signal:AbortSignal.timeout(30_000)});
    await this.repository.savePage(userId,tenantId,brandId,this.connection.name,page.voices);
    return {nextCursor:page.nextCursor};
  }
  select(userId:string,tenantId:string,brandId:string,avatarId:string,raw:unknown,correlationId:string){scope.parse({tenantId,brandId});const {voiceId}=z.object({voiceId:z.uuid()}).strict().parse(raw);return this.repository.select(userId,tenantId,brandId,z.uuid().parse(avatarId),voiceId,correlationId);}
}
