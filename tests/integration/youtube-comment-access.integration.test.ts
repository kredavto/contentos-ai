import {randomUUID,createHash} from 'node:crypto';
import {beforeAll,describe,expect,it,vi} from 'vitest';
import {YouTubeOAuthRepository,SocialRepository} from '../../packages/db/src/index';
import {YouTubeService} from '../../packages/core/src/youtube';
import {CredentialVault} from '../../packages/core/src/credential-vault';
import {seedDevelopment,demoIds} from '../../packages/db/src/development-seed';
import {youtubeCommentsScope,type YouTubeAuthorizationProvider,type YouTubeTokens} from '../../packages/types/src/index';
import {isolatedTestDatabase} from '../helpers/isolated-database';
const url=process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('explicit YouTube comments grant',()=>{
 const database=isolatedTestDatabase(url),repository=new YouTubeOAuthRepository(database.db),social=new SocialRepository(database.db);
 const vault=new CredentialVault(JSON.stringify({test:Buffer.alloc(32,12).toString('base64')}),'test'),{user,tenant,brand}=demoIds;
 const base:YouTubeTokens={accessToken:'synthetic-comments-access',refreshToken:'synthetic-comments-refresh',expiresAt:'2099-01-01T00:00:00.000Z',refreshExpiresAt:null,scopes:['https://www.googleapis.com/auth/youtube.upload','https://www.googleapis.com/auth/youtube.readonly']};
 const full={...base,scopes:[...base.scopes,youtubeCommentsScope]};
 const state=(result:{authorizationUrl:string})=>new URL(result.authorizationUrl).searchParams.get('state')!;
 beforeAll(async()=>{await seedDevelopment(database.db,`scrypt:v1:${'0'.repeat(32)}:${'0'.repeat(128)}`);});
 async function fixture(tokens=base){
  const session=randomUUID(),channelId='UC'+randomUUID().replaceAll('-','').slice(0,22),correlation=randomUUID();
  await database.client`insert into sessions(id,user_id,token_hash,expires_at) values(${session},${user},${createHash('sha256').update(session).digest('hex')},now()+interval '1 hour')`;
  const exchange=vi.fn<YouTubeAuthorizationProvider['exchange']>(async()=>tokens),refresh=vi.fn<YouTubeAuthorizationProvider['refresh']>(async()=>tokens);
  const authorizationUrl=vi.fn<YouTubeAuthorizationProvider['authorizationUrl']>((nonce)=>`https://accounts.google.com/o/oauth2/v2/auth?state=${nonce}`);
  const channel=vi.fn<YouTubeAuthorizationProvider['channel']>(async(_token,ctx)=>({reference:{provider:'youtube',internalId:ctx.internalId,externalId:channelId,metadata:{}},name:'Fixture',username:null}));
  const service=new YouTubeService(repository,social,{exchange,refresh,authorizationUrl,channel,revoke:async()=>{}},vault);
  const context={tenantId:tenant,internalId:randomUUID(),idempotencyKey:randomUUID(),correlationId:correlation,signal:new AbortController().signal};
  async function connect(commentsAccess=false){const started=await service.start(user,session,tenant,brand,{commentsAccess},correlation);const result=await service.callback(user,session,{state:state(started),code:'synthetic'},correlation);if(!('id' in result))throw new Error('Expected connection');return result.id;}
  return {service,session,correlation,exchange,refresh,authorizationUrl,channel,context,connect};
 }
 it('preserves upload-only grants and never trusts a forged capability hint',async()=>{
  const f=await fixture(),id=await f.connect();expect(f.authorizationUrl).toHaveBeenCalledWith(expect.any(String),expect.any(String),false);
  expect((await database.client`select comments_access from youtube_oauth_attempts where connection_id=${id}`)[0]?.comments_access).toBe(false);
  expect(await f.service.accessForPublication(user,tenant,brand,id,1,f.context)).toMatchObject({accessToken:base.accessToken});
  await expect(f.service.accessForComments(user,tenant,brand,id,1,f.context)).rejects.toThrow('NOT_AUTHORIZED');
  await database.client`update social_connections set reference=jsonb_set(reference,'{metadata,commentsAuthorized}','true'::jsonb) where id=${id}`;
  await expect(f.service.accessForComments(user,tenant,brand,id,1,f.context)).rejects.toThrow('NOT_AUTHORIZED');expect(f.refresh).not.toHaveBeenCalled();
 });
 it('persists the requested capability and refuses a partial grant before storing a connection',async()=>{
  const f=await fixture(),started=await f.service.start(user,f.session,tenant,brand,{commentsAccess:true},f.correlation);
  expect(f.authorizationUrl).toHaveBeenCalledWith(expect.any(String),expect.any(String),true);
  const [attempt]=await database.client`select id,connection_id,comments_access from youtube_oauth_attempts where state_hash=${createHash('sha256').update(state(started)).digest('hex')}`;expect(attempt?.comments_access).toBe(true);
  await expect(f.service.callback(user,f.session,{state:state(started),code:'synthetic'},f.correlation)).rejects.toThrow('NOT_AUTHORIZED');expect(f.channel).not.toHaveBeenCalled();
  expect(await database.client`select id from social_connections where id=${attempt!.connection_id}`).toHaveLength(0);
  expect((await database.client`select status,verifier from youtube_oauth_attempts where id=${attempt!.id}`)[0]).toEqual({status:'FAILED',verifier:null});
  f.exchange.mockResolvedValue(full);const id=await f.connect(true);expect(await f.service.accessForComments(user,tenant,brand,id,1,f.context)).toMatchObject({accessToken:base.accessToken});
  const overview=await f.service.overview(user,tenant,brand);expect(overview.connections.find(row=>row.id===id)?.commentsAuthorized).toBe(true);expect(JSON.stringify(overview)).not.toContain(base.accessToken);
 });
 it('rejects scope loss during refresh and fences a concurrent revocation',async()=>{
  const f=await fixture({...full,expiresAt:'2000-01-01T00:00:00.000Z'}),id=await f.connect(true);
  f.refresh.mockResolvedValue(base);await expect(f.service.accessForComments(user,tenant,brand,id,1,f.context)).rejects.toThrow('NOT_AUTHORIZED');expect(f.channel).toHaveBeenCalledTimes(1);
  f.refresh.mockImplementationOnce(async()=>{await social.disconnect(user,tenant,brand,id,0,f.correlation);return full;});
  await expect(f.service.accessForComments(user,tenant,brand,id,1,f.context)).rejects.toThrow('SOCIAL_TOKEN_EXPIRED');
  expect(await social.managed(user,tenant,brand,id)).toMatchObject({status:'REVOKED',credential:null});
 });
 it('does not finish an OAuth attempt whose requested capability changed during exchange',async()=>{
  const f=await fixture(full),started=await f.service.start(user,f.session,tenant,brand,{commentsAccess:true},f.correlation),hash=createHash('sha256').update(state(started)).digest('hex');
  f.exchange.mockImplementationOnce(async()=>{await database.client`update youtube_oauth_attempts set comments_access=false where state_hash=${hash}`;return full;});
  await expect(f.service.callback(user,f.session,{state:state(started),code:'synthetic'},f.correlation)).rejects.toThrow('CONFLICT');
 });
});
