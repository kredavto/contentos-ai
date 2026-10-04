import {randomUUID,randomBytes} from 'node:crypto';
import {describe,it,expect,beforeAll,afterAll} from 'vitest';
import {createDatabase,SocialRepository} from '../../packages/db/src/index';
import {SocialService} from '../../packages/core/src/social';
import {CredentialVault} from '../../packages/core/src/credential-vault';
import {DomainError,type SocialConnectionProvider} from '../../packages/types/src/index';
const url=process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('encrypted tenant social connections',()=>{
  if(url&&!new URL(url).pathname.endsWith('_test'))throw new Error('Dedicated test database required');
  const database=createDatabase(url??'postgresql://localhost/unused_test'),repo=new SocialRepository(database.db);
  const tenantId=randomUUID(),brandId=randomUUID(),workspaceId=randomUUID(),owner=randomUUID(),editor=randomUUID(),correlation=randomUUID();
  const key=randomBytes(32).toString('base64'),vault=new CredentialVault(JSON.stringify({v1:key}),'v1');
  let calls=0,canPublish=true,fail=false;const provider:SocialConnectionProvider={inspect:async(_token,target,context)=>{calls++;if(fail)throw new DomainError('SOCIAL_TOKEN_EXPIRED');return {name:'Fixture channel',username:'fixture',canPublish,reference:{provider:'telegram',externalId:target.startsWith('@')?'-1001234567890':target,internalId:context.internalId,metadata:{botId:'123456'}}};}};
  const service=new SocialService(repo,{name:'telegram',provider},vault),token='123456:fixture_token_not_a_real_credential';let connectionId='';
  const input=()=>({token,target:'@fixture',idempotencyKey:randomUUID()});
  const current=async()=> (await service.overview(owner,tenantId,brandId)).connections.find(row=>row.id===connectionId)!;
  beforeAll(async()=>{
    await database.client`insert into users(id,email,password_hash,name,email_verified_at) values(${owner},${`social-${owner}@example.test`},'unusable','Owner',now()),(${editor},${`social-${editor}@example.test`},'unusable','Editor',now())`;
    await database.client`insert into organizations(id,name) values(${tenantId},'Social tests')`;
    await database.client`insert into organization_members(tenant_id,user_id,role) values(${tenantId},${owner},'OWNER'),(${tenantId},${editor},'EDITOR')`;
    await database.client`insert into workspaces(id,tenant_id,name) values(${workspaceId},${tenantId},'Fixture')`;
    await database.client`insert into brands(id,tenant_id,workspace_id,name) values(${brandId},${tenantId},${workspaceId},'Fixture')`;
  });
  afterAll(()=>database.close());
  it('checks role/brand before external requests and keeps encrypted credentials out of responses',async()=>{
    await expect(service.connect(editor,tenantId,brandId,input(),correlation)).rejects.toThrow('NOT_AUTHORIZED');await expect(service.connect(owner,tenantId,randomUUID(),input(),correlation)).rejects.toThrow('NOT_FOUND');expect(calls).toBe(0);
    const data=input(),created=await service.connect(owner,tenantId,brandId,data,correlation);connectionId=created.id;expect(await service.connect(owner,tenantId,brandId,data,correlation)).toEqual(created);expect(calls).toBe(1);
    const publicResult=await service.overview(editor,tenantId,brandId);expect(publicResult.connections[0]?.status).toBe('ACTIVE');expect(JSON.stringify(publicResult)).not.toContain(token);expect(JSON.stringify(publicResult)).not.toContain('ciphertext');expect(JSON.stringify(publicResult)).not.toContain('botId');
    const stored=await repo.managed(owner,tenantId,brandId,connectionId);expect(vault.decrypt(stored.credential!,{tenantId,brandId,connectionId,provider:'telegram'})).toBe(token);expect(JSON.stringify(stored.credential)).not.toContain(token);
    await expect(service.connect(owner,tenantId,brandId,{...data,target:'@another'},correlation)).rejects.toThrow('CONFLICT');
    await expect(service.overview(randomUUID(),tenantId,brandId)).rejects.toThrow('NOT_FOUND');
  });
  it('persists limited/expired states and can rewrap without changing the credential version',async()=>{
    canPublish=false;await service.refresh(owner,tenantId,brandId,connectionId,{revision:(await current()).revision},correlation);expect((await current()).status).toBe('LIMITED');
    fail=true;await expect(service.refresh(owner,tenantId,brandId,connectionId,{revision:(await current()).revision},correlation)).rejects.toThrow('SOCIAL_TOKEN_EXPIRED');expect((await current()).status).toBe('TOKEN_EXPIRED');fail=false;canPublish=true;
    const rotatedVault=new CredentialVault(JSON.stringify({v1:key,v2:randomBytes(32).toString('base64')}),'v2'),rotating=new SocialService(repo,{name:'telegram',provider},rotatedVault);
    await rotating.rewrap(owner,tenantId,brandId,connectionId,{revision:(await current()).revision},correlation);const stored=await repo.managed(owner,tenantId,brandId,connectionId);expect(stored.credential?.keyId).toBe('v2');expect(stored.credentialVersion).toBe(1);
    await rotating.refresh(owner,tenantId,brandId,connectionId,{revision:(await current()).revision},correlation);expect((await current()).status).toBe('ACTIVE');
  });
  it('fences stale checks, erases the credential on disconnect and explicitly reconnects the same channel',async()=>{
    const row=await current();await service.disconnect(owner,tenantId,brandId,connectionId,{revision:row.revision},correlation);await service.disconnect(owner,tenantId,brandId,connectionId,{revision:row.revision},correlation);
    const disconnected=await repo.managed(owner,tenantId,brandId,connectionId);expect(disconnected.credential).toBeNull();expect(disconnected.status).toBe('REVOKED');
    await expect(service.refresh(owner,tenantId,brandId,connectionId,{revision:row.revision},correlation)).rejects.toThrow('CONFLICT');
    await expect(service.reconnect(editor,tenantId,brandId,connectionId,{revision:disconnected.revision,token},correlation)).rejects.toThrow('NOT_AUTHORIZED');
    await service.reconnect(owner,tenantId,brandId,connectionId,{revision:disconnected.revision,token},correlation);const reconnected=await repo.managed(owner,tenantId,brandId,connectionId);expect(reconnected.status).toBe('ACTIVE');expect(reconnected.credentialVersion).toBe(3);
    expect(await database.client`select id from audit_logs where resource_id=${connectionId} and action='SOCIAL_DISCONNECTED'`).toHaveLength(1);
    const result=await provider.inspect(token,'-1001234567890',{tenantId,internalId:connectionId,idempotencyKey:connectionId,correlationId:correlation,signal:new AbortController().signal});await expect(repo.checked(owner,tenantId,brandId,connectionId,row.revision,result,null,correlation)).rejects.toThrow('CONFLICT');
  });
  it('does not reactivate a connection when a remote check finishes after disconnect',async()=>{
    let signalEntered!:()=>void,signalRelease!:()=>void;
    const entered=new Promise<void>(resolve=>{signalEntered=resolve;}),release=new Promise<void>(resolve=>{signalRelease=resolve;});
    const delayed:SocialConnectionProvider={inspect:async(...args)=>{signalEntered();await release;return provider.inspect(...args);}};
    const checking=new SocialService(repo,{name:'telegram',provider:delayed},vault);
    const revision=(await current()).revision;
    const pending=checking.refresh(owner,tenantId,brandId,connectionId,{revision},correlation);
    const rejected=expect(pending).rejects.toThrow('CONFLICT');
    await entered;
    await service.disconnect(owner,tenantId,brandId,connectionId,{revision},correlation);
    signalRelease();await rejected;
    const stored=await repo.managed(owner,tenantId,brandId,connectionId);
    expect(stored.status).toBe('REVOKED');expect(stored.credential).toBeNull();
  });
});
