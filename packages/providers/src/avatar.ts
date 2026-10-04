import { DomainError,type AvatarProvider } from '@contentos/types';
import { HeyGenAvatarProvider,HeyGenClient } from './heygen';
/** Explicit development fixture. Never sends images or claims a real avatar. */
export class MockAvatarProvider implements AvatarProvider {
  constructor(environment:string){if(!['development','test'].includes(environment))throw new DomainError('CONFIGURATION_REQUIRED',503);}
  async create(input:Parameters<AvatarProvider['create']>[0],context:Parameters<AvatarProvider['create']>[1]){
    context.signal.throwIfAborted();
    return {provider:'mock-avatar',internalId:context.internalId,externalId:`mock-look:${context.internalId}`,metadata:{groupId:input.groupReference?.metadata.groupId??`mock-group:${context.internalId}`}};
  }
  async list(){return [];}
  async status(){return {status:'READY' as const,previewUrl:null};}
  async delete(){}
}
export function avatarFromEnvironment(env:{AVATAR_PROVIDER:string;HEYGEN_API_KEY?:string;NODE_ENV:string}):{provider:AvatarProvider;name:string}|null {
  if(env.AVATAR_PROVIDER==='mock')return {provider:new MockAvatarProvider(env.NODE_ENV),name:'mock-avatar'};
  if(env.AVATAR_PROVIDER==='heygen'&&env.HEYGEN_API_KEY)return {provider:new HeyGenAvatarProvider(new HeyGenClient(env.HEYGEN_API_KEY)),name:'heygen'};
  return null;
}
