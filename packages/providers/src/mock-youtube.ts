import {env as runtimeEnvironment} from 'node:process';
import {createHash} from 'node:crypto';
import {DomainError,normalizedMetricsSchema,youtubeChannelIdSchema,youtubeMetadataSchema,type OperationContext,type YouTubeAuthorizationProvider,type YouTubeCatalogProvider,type YouTubeMetadata,type YouTubePublishingProvider,type YouTubeStatisticsProvider,type YouTubeTokens,type YouTubeUploadResult,type YouTubeVideo} from '@contentos/types';
import {youtubeFromEnvironment} from './youtube';

/** CI external-service simulator. Never enables OAuth or runs outside NODE_ENV=test. */
export class MockYouTubeProvider implements YouTubeAuthorizationProvider,YouTubeCatalogProvider,YouTubePublishingProvider,YouTubeStatisticsProvider{
  private readonly sessions=new Map<string,{metadata:YouTubeMetadata;total:number;offset:number;channelId:string;videoId:string}>();
  constructor(){if(Reflect.get(runtimeEnvironment,'NODE_ENV')!=='test')throw new DomainError('CONFIGURATION_REQUIRED',503);}
  authorizationUrl():string{throw new DomainError('CONFIGURATION_REQUIRED',503);}
  async exchange():Promise<YouTubeTokens>{throw new DomainError('CONFIGURATION_REQUIRED',503);}
  async refresh(tokens:YouTubeTokens){return {...tokens,expiresAt:new Date(Date.now()+3600000).toISOString()};}
  async revoke(){}
  private channelId(token:string){if(!token.startsWith('test-channel:'))throw new DomainError('SOCIAL_TOKEN_EXPIRED');return youtubeChannelIdSchema.parse(token.slice(13));}
  async channel(token:string,context:OperationContext){return {reference:{provider:'youtube',internalId:context.internalId,externalId:this.channelId(token),metadata:{demo:true}},name:'ДЕМО · YouTube',username:null};}
  async categories(token:string){this.channelId(token);return [{id:'22',title:'ДЕМО · People & Blogs'},{id:'27',title:'ДЕМО · Education'}];}
  async startUpload(token:string,metadata:YouTubeMetadata,total:number,context:OperationContext){
    const session=`https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=${context.internalId}`;
    if(this.sessions.has(session))throw new DomainError('RECONCILIATION_REQUIRED');
    this.sessions.set(session,{metadata:youtubeMetadataSchema.parse(metadata),total,offset:0,channelId:this.channelId(token),videoId:createHash('sha256').update(context.internalId).digest('base64url').slice(0,11)});return session;
  }
  private result(session:string,token:string,total:number,channelId:string,context:OperationContext):YouTubeUploadResult{
    const value=this.sessions.get(session);if(!value)return {state:'EXPIRED'};
    if(value.channelId!==this.channelId(token)||value.channelId!==channelId||value.total!==total)throw new DomainError('NOT_AUTHORIZED');
    if(value.offset===total)return {state:'COMPLETE',video:this.record(value,context)};
    return {state:'UPLOADING',nextByte:value.offset,retryAfterSeconds:null};
  }
  private record(value:{videoId:string;channelId:string;metadata:YouTubeMetadata},context:OperationContext):YouTubeVideo{return {reference:{provider:'youtube',internalId:context.internalId,externalId:value.videoId,metadata:{demo:true}},channelId:value.channelId,privacy:value.metadata.privacy,state:'READY',failureCode:null};}
  async probeUpload(token:string,session:string,total:number,channelId:string,context:OperationContext){return this.result(session,token,total,channelId,context);}
  async upload(token:string,session:string,input:{totalBytes:number;offset:number;bytes:Uint8Array;channelId:string},context:OperationContext){
    const result=this.result(session,token,input.totalBytes,input.channelId,context);if(result.state!=='UPLOADING')return result;
    const value=this.sessions.get(session)!;
    if(input.offset!==value.offset||!input.bytes.length||input.offset+input.bytes.length>value.total)throw new DomainError('INVALID_INPUT');
    value.offset+=input.bytes.length;return this.result(session,token,input.totalBytes,input.channelId,context);
  }
  async video(token:string,videoId:string,channelId:string,context:OperationContext){
    const value=[...this.sessions.values()].find(row=>row.videoId===videoId&&row.offset===row.total);if(!value)return null;
    if(value.channelId!==this.channelId(token)||channelId!==value.channelId)throw new DomainError('NOT_AUTHORIZED');return this.record(value,context);
  }
  async statistics(token:string,videoId:string,channelId:string,context:OperationContext){
    context.signal.throwIfAborted();const video=await this.video(token,videoId,channelId,context);if(!video)return null;
    return {reference:video.reference,observedAt:new Date().toISOString(),metrics:normalizedMetricsSchema.parse({views:0,likes:3,comments:2})};
  }
  async thumbnail(token:string,videoId:string,input:{bytes:Uint8Array;mimeType:'image/png'|'image/jpeg'},context:OperationContext){if(!input.bytes.length||!await this.video(token,videoId,this.channelId(token),context))throw new DomainError('INVALID_MEDIA');}
}
export function youtubePublishingFromEnvironment(env:Parameters<typeof youtubeFromEnvironment>[0]&{NODE_ENV:string;YOUTUBE_TEST_MODE?:string}){
  if(env.YOUTUBE_TEST_MODE==='true'){
    if(env.NODE_ENV!=='test')throw new DomainError('CONFIGURATION_REQUIRED',503);
    return new MockYouTubeProvider();
  }
  return youtubeFromEnvironment(env);
}
