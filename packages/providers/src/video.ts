import {readFile,stat} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {DomainError,type VideoProvider,type OperationContext} from '@contentos/types';
import {HeyGenClient,HeyGenVideoProvider} from './heygen';
/** Explicit development fixture; never uses production credentials or network. */
export class MockVideoProvider implements VideoProvider {
  constructor(environment:string,private readonly fixture:string){if(!['development','test'].includes(environment)||!isAbsolute(fixture))throw new DomainError('CONFIGURATION_REQUIRED',503);}
  async submit(_input:Parameters<VideoProvider['submit']>[0],context:OperationContext){context.signal.throwIfAborted();return {provider:'mock-avatar',internalId:context.internalId,externalId:`mock-video:${context.internalId}`,metadata:{demo:true}};}
  async status(){return {status:'READY' as const,downloadUrl:'mock://video-fixture'};}
  async download(url:string,context:OperationContext){
    context.signal.throwIfAborted();if(url!=='mock://video-fixture')throw new DomainError('INVALID_MEDIA',422);
    try{const info=await stat(this.fixture);if(!info.isFile()||info.size>256*1024*1024)throw new DomainError('INVALID_MEDIA',422);return await readFile(this.fixture,{signal:context.signal});}
    catch(error){if(error instanceof DomainError)throw error;throw new DomainError('CONFIGURATION_REQUIRED',503);}
  }
}
export function videoFromEnvironment(env:{VIDEO_PROVIDER:string;HEYGEN_API_KEY?:string;NODE_ENV:string;MOCK_VIDEO_FILE?:string}):{provider:VideoProvider;name:string}|null {
  if(env.VIDEO_PROVIDER==='heygen'&&env.HEYGEN_API_KEY)return {provider:new HeyGenVideoProvider(new HeyGenClient(env.HEYGEN_API_KEY)),name:'heygen'};
  if(env.VIDEO_PROVIDER==='mock'&&env.MOCK_VIDEO_FILE)return {provider:new MockVideoProvider(env.NODE_ENV,env.MOCK_VIDEO_FILE),name:'mock-avatar'};
  return null;
}
