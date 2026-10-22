import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {YouTubeOAuthRepository,SocialRepository} from '@contentos/db';
import {DomainError,youtubeConnectSchema,youtubeCallbackSchema,youtubeTokensSchema,socialRevisionSchema,type YouTubeAuthorizationProvider,type OperationContext} from '@contentos/types';
import {CredentialVault} from './credential-vault';
const uuid=z.uuid();
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
function storedTokens(encoded:string){
  let value:unknown;try{value=JSON.parse(encoded);}catch{throw new DomainError('SOCIAL_TOKEN_EXPIRED',409);}
  const parsed=youtubeTokensSchema.safeParse(value);if(!parsed.success)throw new DomainError('SOCIAL_TOKEN_EXPIRED',409);return parsed.data;
}
export class YouTubeService{
  constructor(private readonly repository:YouTubeOAuthRepository,private readonly social:SocialRepository,private readonly provider:YouTubeAuthorizationProvider|null,private readonly vault:CredentialVault|null){}
  async overview(userId:string,tenantId:string,brandId:string){
    const connections=(await this.social.list(userId,uuid.parse(tenantId),uuid.parse(brandId))).filter(row=>row.provider==='youtube').map(({privacy:_privacy,commentsEnabled:_comments,...row})=>row);
    return {connections,configuration:{ready:!!this.provider&&!!this.vault,status:this.provider&&this.vault?'CONFIGURED' as const:'CONFIGURATION_REQUIRED' as const}};
  }
  async start(userId:string,sessionId:string,tenantId:string,brandId:string,raw:unknown,correlationId:string){
    uuid.parse(sessionId);uuid.parse(tenantId);uuid.parse(brandId);const value=youtubeConnectSchema.parse(raw);
    await this.repository.authorize(userId,tenantId,brandId,sessionId);
    if(!this.provider||!this.vault)throw new DomainError('CONFIGURATION_REQUIRED',503);
    const id=randomUUID(),connectionId=value.connectionId??randomUUID(),state=randomBytes(32).toString('base64url'),verifier=randomBytes(48).toString('base64url');
    const authorizationUrl=this.provider.authorizationUrl(state,verifier);
    const saved=await this.repository.begin(userId,tenantId,brandId,sessionId,{id,connectionId,reconnectId:value.connectionId??null,revision:value.revision??null,stateHash:hash(state),verifier:this.vault.encrypt(verifier,{tenantId,brandId,connectionId:id,provider:'youtube-oauth'})},correlationId);
    return {authorizationUrl,expiresAt:saved.expiresAt};
  }
  async callback(userId:string,sessionId:string,raw:unknown,correlationId:string){
    const value=youtubeCallbackSchema.parse(raw);uuid.parse(sessionId);
    if(!this.provider||!this.vault)throw new DomainError('CONFIGURATION_REQUIRED',503);
    const attempt=await this.repository.consume(userId,sessionId,hash(value.state));
    if(value.error){await this.repository.fail(userId,attempt,'NOT_AUTHORIZED',correlationId);return {tenantId:attempt.tenantId,brandId:attempt.brandId,connected:false};}
    try{
      const verifier=this.vault.decrypt(attempt.verifier!,{tenantId:attempt.tenantId,brandId:attempt.brandId,connectionId:attempt.id,provider:'youtube-oauth'});
      const context=this.context(attempt.tenantId,attempt.connectionId,correlationId);
      const tokens=await this.provider.exchange(value.code!,verifier,context);
      youtubeTokensSchema.parse(tokens);
      const channel=await this.provider.channel(tokens.accessToken,context);
      const credential=this.vault.encrypt(JSON.stringify(tokens),{tenantId:attempt.tenantId,brandId:attempt.brandId,connectionId:attempt.connectionId,provider:'youtube'});
      const result=await this.repository.finish(userId,attempt,channel,credential,correlationId);return {...result,connected:true};
    }catch(error){await this.repository.fail(userId,attempt,error instanceof DomainError?error.code:'PROVIDER_UNAVAILABLE',correlationId);throw error;}
  }
  async check(userId:string,tenantId:string,brandId:string,id:string,raw:unknown,correlationId:string){
    uuid.parse(tenantId);uuid.parse(brandId);uuid.parse(id);const {revision}=socialRevisionSchema.parse(raw);
    const row=await this.social.managed(userId,tenantId,brandId,id);
    if(row.provider!=='youtube')throw new DomainError('NOT_FOUND',404);
    if(row.status==='REVOKED'||!row.credential||row.revision!==revision)throw new DomainError('CONFLICT',409);
    if(!this.provider||!this.vault)throw new DomainError('CONFIGURATION_REQUIRED',503);
    const scope={tenantId,brandId,connectionId:id,provider:'youtube'},context=this.context(tenantId,id,correlationId);
    try{
      let tokens=storedTokens(this.vault.decrypt(row.credential,scope));
      if(Date.parse(tokens.expiresAt)<=Date.now()+60000)tokens=await this.provider.refresh(tokens,context);
      const channel=await this.provider.channel(tokens.accessToken,context);
      return await this.repository.checked(userId,tenantId,brandId,id,revision,channel,this.vault.encrypt(JSON.stringify(youtubeTokensSchema.parse(tokens)),scope),correlationId);
    }catch(error){
      if(error instanceof DomainError&&['SOCIAL_TOKEN_EXPIRED','NOT_AUTHORIZED','PROVIDER_UNAVAILABLE','PROVIDER_REJECTED'].includes(error.code))await this.social.checkFailed(userId,tenantId,brandId,id,revision,error.code,correlationId);
      throw error;
    }
  }
  /** Worker-only secret boundary; no HTTP route exposes this result. */
  async accessForPublication(userId:string,tenantId:string,brandId:string,id:string,generation:number,context:OperationContext){
    if(context.tenantId!==tenantId)throw new DomainError('NOT_AUTHORIZED',403);
    if(!this.provider||!this.vault)throw new DomainError('CONFIGURATION_REQUIRED',503);
    const scope={tenantId,brandId,connectionId:id,provider:'youtube'};
    const current=async()=>{
      const row=await this.social.managed(userId,tenantId,brandId,id);
      if(row.provider!=='youtube'||row.status!=='ACTIVE'||!row.credential||row.credentialVersion!==generation)throw new DomainError('SOCIAL_TOKEN_EXPIRED',409);
      return {row,tokens:storedTokens(this.vault!.decrypt(row.credential,scope))};
    };
    const {row,tokens}=await current();
    if(Date.parse(tokens.expiresAt)>Date.now()+60000)return {accessToken:tokens.accessToken,channelId:row.reference.externalId};
    const providerContext={...context,internalId:id},renewed=youtubeTokensSchema.parse(await this.provider.refresh(tokens,providerContext));
    const channel=await this.provider.channel(renewed.accessToken,providerContext);
    try{await this.repository.checked(userId,tenantId,brandId,id,row.revision,channel,this.vault.encrypt(JSON.stringify(renewed),scope),context.correlationId);}
    catch(error){
      if(!(error instanceof DomainError&&error.code==='CONFLICT'))throw error;
      // Another job can renew the same grant concurrently. Use only its committed token, never a changed grant.
      const latest=await current();if(latest.row.reference.externalId!==row.reference.externalId||Date.parse(latest.tokens.expiresAt)<=Date.now()+60000)throw error;
      return {accessToken:latest.tokens.accessToken,channelId:latest.row.reference.externalId};
    }
    return {accessToken:renewed.accessToken,channelId:channel.reference.externalId};
  }
  private context(tenantId:string,internalId:string,correlationId:string):OperationContext{return {tenantId,internalId,idempotencyKey:internalId,correlationId,signal:AbortSignal.timeout(45000)};}
}
