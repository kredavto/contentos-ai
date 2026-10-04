import {randomUUID} from 'node:crypto';
import {and,eq,desc} from 'drizzle-orm';
import {DomainError,type VoiceCatalogProvider} from '@contentos/types';
import type {Database} from '../index';
import {voiceProfiles,avatars,brands,auditLogs} from '../schema';
import {AuthRepository} from './auth';
import {assertMembership,lockTenant} from './ledger';
type CatalogVoice=Awaited<ReturnType<VoiceCatalogProvider['listPublicVoicePage']>>['voices'][number];
export class VoiceRepository {
  constructor(private readonly db:Database){}
  async authorize(userId:string,tenantId:string,brandId:string,write=false){
    await this.db.transaction(async tx=>{await assertMembership(tx,userId,tenantId,write?'generate':undefined);const [brand]=await tx.select({id:brands.id}).from(brands).where(and(eq(brands.tenantId,tenantId),eq(brands.id,brandId)));if(!brand)throw new DomainError('NOT_FOUND',404);});
  }
  async allowRefresh(tenantId:string){if(!await new AuthRepository(this.db).rateLimit(`voice-catalog:${tenantId}`,30,60))throw new DomainError('RATE_LIMITED',429);}
  async list(userId:string,tenantId:string,brandId:string){
    await this.authorize(userId,tenantId,brandId);
    return this.db.select({id:voiceProfiles.id,name:voiceProfiles.name,language:voiceProfiles.language,previewUrl:voiceProfiles.previewUrl,provider:voiceProfiles.provider}).from(voiceProfiles).where(and(eq(voiceProfiles.tenantId,tenantId),eq(voiceProfiles.brandId,brandId))).orderBy(desc(voiceProfiles.refreshedAt)).limit(500);
  }
  async savePage(userId:string,tenantId:string,brandId:string,provider:string,voices:CatalogVoice[]){
    return this.db.transaction(async tx=>{
      await lockTenant(tx,tenantId);await assertMembership(tx,userId,tenantId,'generate');
      for(const voice of voices){
        if(voice.reference.provider!==provider||voice.reference.metadata.public!==true)throw new DomainError('PROVIDER_REJECTED',502);
        const id=randomUUID();
        const values={tenantId,brandId,provider,externalId:voice.reference.externalId,reference:{...voice.reference,internalId:id},name:voice.name,language:voice.language,previewUrl:voice.previewUrl};
        // Existing internal IDs stay stable through provider catalog refreshes.
        await tx.insert(voiceProfiles).values({id,...values}).onConflictDoUpdate({target:[voiceProfiles.tenantId,voiceProfiles.brandId,voiceProfiles.provider,voiceProfiles.externalId],set:{name:voice.name,language:voice.language,previewUrl:voice.previewUrl,refreshedAt:new Date()}});
      }
    });
  }
  async select(userId:string,tenantId:string,brandId:string,avatarId:string,voiceId:string,correlationId:string){
    await this.db.transaction(async tx=>{
      await lockTenant(tx,tenantId);await assertMembership(tx,userId,tenantId,'generate');
      const [avatar]=await tx.select().from(avatars).where(and(eq(avatars.tenantId,tenantId),eq(avatars.brandId,brandId),eq(avatars.id,avatarId),eq(avatars.status,'ACTIVE')));
      const [voice]=await tx.select().from(voiceProfiles).where(and(eq(voiceProfiles.tenantId,tenantId),eq(voiceProfiles.brandId,brandId),eq(voiceProfiles.id,voiceId)));
      if(!avatar||!voice)throw new DomainError('NOT_FOUND',404);
      if(voice.provider!==avatar.provider||voice.reference.metadata.public!==true)throw new DomainError('INVALID_INPUT');
      await tx.update(avatars).set({voiceId}).where(and(eq(avatars.tenantId,tenantId),eq(avatars.id,avatarId)));
      await tx.insert(auditLogs).values({tenantId,userId,action:'AVATAR_VOICE_SELECTED',resourceId:avatarId,correlationId,metadata:{voiceId}});
    });
  }
}
