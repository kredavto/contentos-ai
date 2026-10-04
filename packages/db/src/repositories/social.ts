import {and,eq,sql,desc} from 'drizzle-orm';
import {DomainError,type EncryptedCredential,type SocialConnectionProvider} from '@contentos/types';
import type {Database} from '../index';
import {socialConnections,brands,auditLogs} from '../schema';
import {assertMembership,lockTenant,type Transaction} from './ledger';
type Inspection=Awaited<ReturnType<SocialConnectionProvider['inspect']>>;
export type StoredSocialConnection=typeof socialConnections.$inferSelect;
const where=(tenantId:string,brandId:string,id:string)=>and(eq(socialConnections.tenantId,tenantId),eq(socialConnections.brandId,brandId),eq(socialConnections.id,id));
async function authorize(tx:Transaction,userId:string,tenantId:string,brandId:string,manage=false){await assertMembership(tx,userId,tenantId,manage?'strategy':'read');const [brand]=await tx.select({id:brands.id}).from(brands).where(and(eq(brands.tenantId,tenantId),eq(brands.id,brandId)));if(!brand)throw new DomainError('NOT_FOUND',404);}
export class SocialRepository{
  constructor(private readonly db:Database){}
  async list(userId:string,tenantId:string,brandId:string){return this.db.transaction(async tx=>{await authorize(tx,userId,tenantId,brandId);return tx.select({id:socialConnections.id,name:socialConnections.name,username:socialConnections.username,provider:socialConnections.provider,status:socialConnections.status,revision:socialConnections.revision,lastCheckedAt:socialConnections.lastCheckedAt,errorCode:socialConnections.errorCode}).from(socialConnections).where(and(eq(socialConnections.tenantId,tenantId),eq(socialConnections.brandId,brandId))).orderBy(desc(socialConnections.createdAt)).limit(100);});}
  async intent(userId:string,tenantId:string,brandId:string,key:string,inputHash:string){return this.db.transaction(async tx=>{await authorize(tx,userId,tenantId,brandId,true);const [existing]=await tx.select().from(socialConnections).where(and(eq(socialConnections.tenantId,tenantId),eq(socialConnections.idempotencyKey,key)));if(existing&&(existing.brandId!==brandId||existing.inputHash!==inputHash||existing.createdBy!==userId))throw new DomainError('CONFLICT',409);return existing?{id:existing.id,status:existing.status,revision:existing.revision}:null;});}
  async create(userId:string,tenantId:string,brandId:string,id:string,key:string,inputHash:string,provider:string,result:Inspection,credential:EncryptedCredential,correlationId:string){
    return this.db.transaction(async tx=>{await lockTenant(tx,tenantId);await authorize(tx,userId,tenantId,brandId,true);
      const [existing]=await tx.select().from(socialConnections).where(and(eq(socialConnections.tenantId,tenantId),eq(socialConnections.idempotencyKey,key)));if(existing){if(existing.inputHash!==inputHash||existing.createdBy!==userId||existing.brandId!==brandId)throw new DomainError('CONFLICT',409);return {id:existing.id,status:existing.status,revision:existing.revision};}
      if(result.reference.provider!==provider||result.reference.internalId!==id)throw new DomainError('PROVIDER_REJECTED',502);
      const [duplicate]=await tx.select({id:socialConnections.id}).from(socialConnections).where(and(eq(socialConnections.tenantId,tenantId),eq(socialConnections.brandId,brandId),eq(socialConnections.provider,provider),sql`${socialConnections.reference}->>'externalId' = ${result.reference.externalId}`));if(duplicate)throw new DomainError('CONFLICT',409);
      const [row]=await tx.insert(socialConnections).values({id,tenantId,brandId,provider,reference:result.reference,name:result.name,username:result.username,status:result.canPublish?'ACTIVE':'LIMITED',credential,createdBy:userId,idempotencyKey:key,inputHash,lastCheckedAt:new Date()}).returning({id:socialConnections.id,status:socialConnections.status,revision:socialConnections.revision});
      await tx.insert(auditLogs).values({tenantId,userId,action:'SOCIAL_CONNECTED',resourceId:id,correlationId,metadata:{provider,status:row!.status}});return row!;
    });
  }
  async managed(userId:string,tenantId:string,brandId:string,id:string){return this.db.transaction(async tx=>{await authorize(tx,userId,tenantId,brandId,true);const [row]=await tx.select().from(socialConnections).where(where(tenantId,brandId,id));if(!row)throw new DomainError('NOT_FOUND',404);return row;});}
  async checked(userId:string,tenantId:string,brandId:string,id:string,revision:number,result:Inspection,credential:EncryptedCredential|null,correlationId:string){
    return this.db.transaction(async tx=>{await lockTenant(tx,tenantId);await authorize(tx,userId,tenantId,brandId,true);const [row]=await tx.select().from(socialConnections).where(where(tenantId,brandId,id));if(!row)throw new DomainError('NOT_FOUND',404);
      if(row.revision!==revision||(!credential&&row.status==='REVOKED'))throw new DomainError('CONFLICT',409);
      if(result.reference.provider!==row.provider||result.reference.externalId!==row.reference.externalId||result.reference.internalId!==row.id)throw new DomainError('CONFLICT',409);
      await tx.update(socialConnections).set({reference:result.reference,name:result.name,username:result.username,status:result.canPublish?'ACTIVE':'LIMITED',revision:revision+1,lastCheckedAt:new Date(),errorCode:null,updatedAt:new Date(),...(credential?{credential,credentialVersion:row.credentialVersion+1}:{})}).where(where(tenantId,brandId,id));
      await tx.insert(auditLogs).values({tenantId,userId,action:credential?'SOCIAL_CREDENTIAL_REPLACED':'SOCIAL_CHECKED',resourceId:id,correlationId,metadata:{revision:revision+1,status:result.canPublish?'ACTIVE':'LIMITED'}});return {id,revision:revision+1};
    });
  }
  async checkFailed(userId:string,tenantId:string,brandId:string,id:string,revision:number,code:string,correlationId:string){
    await this.db.transaction(async tx=>{await lockTenant(tx,tenantId);await authorize(tx,userId,tenantId,brandId,true);const [row]=await tx.select().from(socialConnections).where(where(tenantId,brandId,id));if(!row||row.revision!==revision||row.status==='REVOKED')return;
      const status=code==='SOCIAL_TOKEN_EXPIRED'?'TOKEN_EXPIRED':code==='NOT_AUTHORIZED'?'LIMITED':'ERROR';
      await tx.update(socialConnections).set({status,errorCode:code,revision:revision+1,lastCheckedAt:new Date(),updatedAt:new Date()}).where(where(tenantId,brandId,id));
      await tx.insert(auditLogs).values({tenantId,userId,action:'SOCIAL_CHECK_FAILED',resourceId:id,correlationId,metadata:{code,status}});
    });
  }
  async disconnect(userId:string,tenantId:string,brandId:string,id:string,revision:number,correlationId:string){
    await this.db.transaction(async tx=>{await lockTenant(tx,tenantId);await authorize(tx,userId,tenantId,brandId,true);const [row]=await tx.select().from(socialConnections).where(where(tenantId,brandId,id));if(!row)throw new DomainError('NOT_FOUND',404);if(row.status==='REVOKED')return;if(row.revision!==revision)throw new DomainError('CONFLICT',409);
      await tx.update(socialConnections).set({status:'REVOKED',credential:null,credentialVersion:row.credentialVersion+1,revision:revision+1,errorCode:null,updatedAt:new Date()}).where(where(tenantId,brandId,id));
      await tx.insert(auditLogs).values({tenantId,userId,action:'SOCIAL_DISCONNECTED',resourceId:id,correlationId});
    });
  }
  async rewrap(userId:string,tenantId:string,brandId:string,id:string,revision:number,credential:EncryptedCredential,correlationId:string){
    await this.db.transaction(async tx=>{await lockTenant(tx,tenantId);await authorize(tx,userId,tenantId,brandId,true);const [row]=await tx.select().from(socialConnections).where(where(tenantId,brandId,id));if(!row)throw new DomainError('NOT_FOUND',404);if(row.revision!==revision||!row.credential||row.status==='REVOKED')throw new DomainError('CONFLICT',409);
      await tx.update(socialConnections).set({credential,revision:revision+1,updatedAt:new Date()}).where(where(tenantId,brandId,id));await tx.insert(auditLogs).values({tenantId,userId,action:'SOCIAL_CREDENTIAL_REWRAPPED',resourceId:id,correlationId,metadata:{keyId:credential.keyId}});
    });
  }
}
