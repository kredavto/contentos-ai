import {and,eq,sql} from 'drizzle-orm';
import {DomainError,type EncryptedCredential,type YouTubeAuthorizationProvider} from '@contentos/types';
import type {Database} from '../index';
import {youtubeOAuthAttempts,socialConnections,sessions,auditLogs} from '../schema';
import {lockTenant,type Transaction} from './ledger';
import {authorizeSocial} from './social';
import {cancelConnectionPublishing} from './publishing';
import {cancelConnectionAnalytics} from './channel-analytics';
type Attempt=typeof youtubeOAuthAttempts.$inferSelect;
type Channel=Awaited<ReturnType<YouTubeAuthorizationProvider['channel']>>;
async function session(tx:Transaction,userId:string,sessionId:string){
  const [row]=await tx.select({id:sessions.id}).from(sessions).where(and(eq(sessions.id,sessionId),eq(sessions.userId,userId),sql`${sessions.expiresAt}>clock_timestamp()`)).for('share');
  if(!row)throw new DomainError('NOT_AUTHORIZED',401);
}
export class YouTubeOAuthRepository{
  constructor(private readonly db:Database){}
  async authorize(userId:string,tenantId:string,brandId:string,sessionId:string){return this.db.transaction(async tx=>{await authorizeSocial(tx,userId,tenantId,brandId,true);await session(tx,userId,sessionId);});}
  async begin(userId:string,tenantId:string,brandId:string,sessionId:string,input:{commentsAccess?:boolean;id:string;connectionId:string;reconnectId:string|null;revision:number|null;stateHash:string;verifier:EncryptedCredential},correlationId:string){
    return this.db.transaction(async tx=>{
      await lockTenant(tx,tenantId);await authorizeSocial(tx,userId,tenantId,brandId,true);await session(tx,userId,sessionId);
      if(input.reconnectId){
        const [row]=await tx.select().from(socialConnections).where(and(eq(socialConnections.tenantId,tenantId),eq(socialConnections.brandId,brandId),eq(socialConnections.id,input.reconnectId)));
        if(!row||row.provider!=='youtube')throw new DomainError('NOT_FOUND',404);if(row.revision!==input.revision)throw new DomainError('CONFLICT',409);
      }
      await tx.delete(youtubeOAuthAttempts).where(and(eq(youtubeOAuthAttempts.tenantId,tenantId),eq(youtubeOAuthAttempts.createdBy,userId),sql`${youtubeOAuthAttempts.expiresAt}<clock_timestamp()`));
      const [counter]=await tx.select({count:sql<number>`count(*)::int`}).from(youtubeOAuthAttempts).where(and(eq(youtubeOAuthAttempts.tenantId,tenantId),eq(youtubeOAuthAttempts.createdBy,userId),eq(youtubeOAuthAttempts.status,'PENDING')));
      if(!counter||counter.count>=10)throw new DomainError('RATE_LIMITED',429);
      const [row]=await tx.insert(youtubeOAuthAttempts).values({...input,tenantId,brandId,sessionId,createdBy:userId}).returning({expiresAt:youtubeOAuthAttempts.expiresAt});
      await tx.insert(auditLogs).values({tenantId,userId,action:'YOUTUBE_OAUTH_STARTED',resourceId:input.id,correlationId,metadata:{reconnect:!!input.reconnectId,commentsAccess:input.commentsAccess??false}});return row!;
    });
  }
  async consume(userId:string,sessionId:string,stateHash:string){
    return this.db.transaction(async tx=>{
      const condition=and(eq(youtubeOAuthAttempts.stateHash,stateHash),eq(youtubeOAuthAttempts.createdBy,userId),eq(youtubeOAuthAttempts.sessionId,sessionId),eq(youtubeOAuthAttempts.status,'PENDING'),sql`${youtubeOAuthAttempts.expiresAt}>clock_timestamp()`);
      const [located]=await tx.select({tenantId:youtubeOAuthAttempts.tenantId,brandId:youtubeOAuthAttempts.brandId}).from(youtubeOAuthAttempts).where(condition);
      if(!located)throw new DomainError('INVALID_INPUT');
      await lockTenant(tx,located.tenantId);await authorizeSocial(tx,userId,located.tenantId,located.brandId,true);await session(tx,userId,sessionId);
      const [row]=await tx.select().from(youtubeOAuthAttempts).where(condition).for('update');if(!row)throw new DomainError('INVALID_INPUT');
      await tx.update(youtubeOAuthAttempts).set({status:'EXCHANGING',verifier:null}).where(eq(youtubeOAuthAttempts.id,row.id));return row;
    });
  }
  async finish(userId:string,attempt:Attempt,channel:Channel,credential:EncryptedCredential,correlationId:string){
    return this.db.transaction(async tx=>{
      const {tenantId,brandId,connectionId}=attempt;
      await lockTenant(tx,tenantId);await authorizeSocial(tx,userId,tenantId,brandId,true);await session(tx,userId,attempt.sessionId);
      const [current]=await tx.select().from(youtubeOAuthAttempts).where(and(eq(youtubeOAuthAttempts.id,attempt.id),eq(youtubeOAuthAttempts.tenantId,tenantId),eq(youtubeOAuthAttempts.createdBy,userId),eq(youtubeOAuthAttempts.sessionId,attempt.sessionId),eq(youtubeOAuthAttempts.status,'EXCHANGING'),sql`${youtubeOAuthAttempts.expiresAt}>clock_timestamp()`)).for('update');
      if(!current||current.connectionId!==connectionId||current.brandId!==brandId||current.commentsAccess!==attempt.commentsAccess)throw new DomainError('CONFLICT',409);
      if(current.commentsAccess&&channel.reference.metadata.commentsAuthorized!==true)throw new DomainError('NOT_AUTHORIZED',403);
      if(channel.reference.provider!=='youtube'||channel.reference.internalId!==connectionId)throw new DomainError('PROVIDER_REJECTED',502);
      let revision=0;
      if(current.reconnectId){
        const [old]=await tx.select().from(socialConnections).where(and(eq(socialConnections.id,current.reconnectId),eq(socialConnections.tenantId,tenantId),eq(socialConnections.brandId,brandId)));
        if(!old||old.revision!==current.revision||old.provider!=='youtube'||old.reference.externalId!==channel.reference.externalId)throw new DomainError('CONFLICT',409);
        revision=old.revision+1;
        await tx.update(socialConnections).set({credential,credentialVersion:old.credentialVersion+1,revision,status:'ACTIVE',reference:channel.reference,name:channel.name,username:channel.username,errorCode:null,lastCheckedAt:sql`now()`,updatedAt:sql`now()`}).where(and(eq(socialConnections.id,connectionId),eq(socialConnections.tenantId,tenantId)));
        await cancelConnectionPublishing(tx,tenantId,connectionId,userId);await cancelConnectionAnalytics(tx,tenantId,connectionId,userId);
      }else{
        const [duplicate]=await tx.select({id:socialConnections.id}).from(socialConnections).where(and(eq(socialConnections.tenantId,tenantId),eq(socialConnections.brandId,brandId),eq(socialConnections.provider,'youtube'),sql`${socialConnections.reference}->>'externalId'=${channel.reference.externalId}`));
        if(duplicate)throw new DomainError('CONFLICT',409);
        await tx.insert(socialConnections).values({id:connectionId,tenantId,brandId,provider:'youtube',reference:channel.reference,name:channel.name,username:channel.username,status:'ACTIVE',credential,createdBy:userId,idempotencyKey:attempt.id,inputHash:attempt.stateHash,lastCheckedAt:sql`now()`});
      }
      await tx.update(youtubeOAuthAttempts).set({status:'COMPLETED',finishedAt:sql`now()`}).where(eq(youtubeOAuthAttempts.id,attempt.id));
      await tx.insert(auditLogs).values({tenantId,userId,action:current.reconnectId?'YOUTUBE_RECONNECTED':'YOUTUBE_CONNECTED',resourceId:connectionId,correlationId,metadata:{revision}});
      return {id:connectionId,revision,tenantId,brandId};
    });
  }
  async fail(userId:string,attempt:Attempt,code:string,correlationId:string){
    await this.db.transaction(async tx=>{
      await authorizeSocial(tx,userId,attempt.tenantId,attempt.brandId,true);await session(tx,userId,attempt.sessionId);
      const [row]=await tx.update(youtubeOAuthAttempts).set({status:'FAILED',errorCode:code,finishedAt:sql`now()`}).where(and(eq(youtubeOAuthAttempts.id,attempt.id),eq(youtubeOAuthAttempts.tenantId,attempt.tenantId),eq(youtubeOAuthAttempts.createdBy,userId),eq(youtubeOAuthAttempts.status,'EXCHANGING'))).returning({id:youtubeOAuthAttempts.id});
      if(row)await tx.insert(auditLogs).values({tenantId:attempt.tenantId,userId,action:'YOUTUBE_OAUTH_FAILED',resourceId:attempt.id,correlationId,metadata:{code}});
    });
  }
  async checked(userId:string,tenantId:string,brandId:string,id:string,revision:number,channel:Channel,credential:EncryptedCredential,correlationId:string){
    return this.db.transaction(async tx=>{
      await lockTenant(tx,tenantId);await authorizeSocial(tx,userId,tenantId,brandId,true);
      const condition=and(eq(socialConnections.tenantId,tenantId),eq(socialConnections.brandId,brandId),eq(socialConnections.id,id));
      const [row]=await tx.select().from(socialConnections).where(condition);
      if(!row||row.provider!=='youtube')throw new DomainError('NOT_FOUND',404);
      if(row.status==='REVOKED'||row.revision!==revision||row.reference.externalId!==channel.reference.externalId||channel.reference.internalId!==id||channel.reference.provider!=='youtube')throw new DomainError('CONFLICT',409);
      // Access-token renewal is the same grant, so it must not cancel approved jobs.
      await tx.update(socialConnections).set({credential,status:'ACTIVE',reference:channel.reference,name:channel.name,username:channel.username,revision:revision+1,lastCheckedAt:sql`now()`,updatedAt:sql`now()`,errorCode:null}).where(condition);
      await tx.insert(auditLogs).values({tenantId,userId,action:'YOUTUBE_CHECKED',resourceId:id,correlationId,metadata:{revision:revision+1}});return {id,revision:revision+1};
    });
  }
}
