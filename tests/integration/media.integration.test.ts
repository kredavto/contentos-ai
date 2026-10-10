import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {beforeAll,afterAll,describe,expect,it} from 'vitest';
import {createDatabase,MediaRepository} from '../../packages/db/src/index';
import {MediaService} from '../../packages/core/src/media';
import type {StorageProvider} from '../../packages/types/src/providers';
const url=process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('tenant media lifecycle',()=>{
  if(url&&!new URL(url).pathname.endsWith('_test'))throw new Error('Dedicated test database required');
  const database=createDatabase(url??'postgresql://localhost/unused_test');const repo=new MediaRepository(database.db);
  const tenantId=randomUUID(),userId=randomUUID(),viewerId=randomUUID(),workspaceId=randomUUID(),brandId=randomUUID(),secondBrand=randomUUID(),correlationId=randomUUID();
  const objects=new Map<string,Uint8Array>();let writes=0,failPut=false,failDelete=false;let image:Buffer;
  const storage:StorageProvider={get:async key=>{const bytes=objects.get(key);if(!bytes)throw new Error('Missing fixture');return bytes;},put:async(key,bytes)=>{writes++;if(failPut)throw new Error('fixture unavailable');objects.set(key,bytes);},signedDownload:async(key,ttl)=>`https://storage.example.test/${key}?ttl=${ttl}`,delete:async key=>{if(failDelete)throw new Error('fixture unavailable');objects.delete(key);}};
  const service=new MediaService(repo,storage,`fixture-${tenantId}`);const input=()=>({name:'Fictional photograph.png',mimeType:'image/png',idempotencyKey:randomUUID()});
  beforeAll(async()=>{
    await database.client`insert into users(id,email,password_hash,name,email_verified_at) values(${userId},${`media-${userId}@example.test`},'test-unusable','Fictional owner',now()),(${viewerId},${`media-${viewerId}@example.test`},'test-unusable','Fictional viewer',now())`;
    await database.client`insert into organizations(id,name) values(${tenantId},'Media tests')`;
    await database.client`insert into organization_members(tenant_id,user_id,role) values(${tenantId},${userId},'OWNER'),(${tenantId},${viewerId},'VIEWER')`;
    await database.client`insert into workspaces(id,tenant_id,name) values(${workspaceId},${tenantId},'Test workspace')`;
    await database.client`insert into brands(id,tenant_id,workspace_id,name) values(${brandId},${tenantId},${workspaceId},'Test brand'),(${secondBrand},${tenantId},${workspaceId},'Other brand')`;
    image=await sharp({create:{width:200,height:300,channels:3,background:'#aaddff'}}).png().toBuffer();
  });
  afterAll(()=>database.close());
  it('stores normalized bytes once, hides storage keys, and scopes access to brand and tenant',async()=>{
    const request=input();const asset=await service.upload(userId,tenantId,brandId,request,image,correlationId);
    expect(asset.status).toBe('READY');expect((await service.upload(userId,tenantId,brandId,request,image,correlationId)).id).toBe(asset.id);expect(writes).toBe(1);
    const overview=await service.overview(viewerId,tenantId,brandId);expect(overview.assets[0]?.mimeType).toBe('image/jpeg');expect(JSON.stringify(overview)).not.toContain('storageKey');
    expect((await service.download(viewerId,tenantId,brandId,asset.id)).expiresInSeconds).toBe(60);
    await expect(service.download(userId,tenantId,secondBrand,asset.id)).rejects.toThrow('NOT_FOUND');
    await expect(service.download(userId,randomUUID(),brandId,asset.id)).rejects.toThrow('NOT_FOUND');
    await expect(service.upload(viewerId,tenantId,brandId,input(),image,correlationId)).rejects.toThrow('NOT_AUTHORIZED');
    await expect(service.upload(userId,tenantId,brandId,{...request,name:'changed.png'},image,correlationId)).rejects.toThrow('CONFLICT');
    const disabled=new MediaService(repo,null);await expect(disabled.upload(userId,tenantId,brandId,input(),image,correlationId)).rejects.toThrow('CONFIGURATION_REQUIRED');
  });
  it('retries a failed upload using the same intent and rejects concurrent ownership',async()=>{
    const request=input();failPut=true;await expect(service.upload(userId,tenantId,brandId,request,image,correlationId)).rejects.toThrow('PROVIDER_UNAVAILABLE');failPut=false;
    const result=await service.upload(userId,tenantId,brandId,request,image,correlationId);expect(result.status).toBe('READY');
    const concurrent=await Promise.allSettled([service.upload(userId,tenantId,brandId,input(),image,correlationId),service.upload(viewerId,tenantId,brandId,input(),image,correlationId)]);expect(concurrent.map(r=>r.status)).toEqual(['fulfilled','rejected']);
    const same=input();const pair=await Promise.allSettled([service.upload(userId,tenantId,brandId,same,image,correlationId),service.upload(userId,tenantId,brandId,same,image,correlationId)]);
    const successful=pair.filter(r=>r.status==='fulfilled');expect(successful.length).toBeGreaterThan(0);
    const rows=await database.client`select id from media_assets where tenant_id=${tenantId} and idempotency_key=${same.idempotencyKey}`;expect(rows).toHaveLength(1);
  });
  it('revokes download immediately, persists failed deletion, and retries without resurrection',async()=>{
    const asset=await service.upload(userId,tenantId,brandId,input(),image,correlationId);
    await expect(service.delete(viewerId,tenantId,brandId,asset.id,correlationId)).rejects.toThrow('NOT_AUTHORIZED');
    await service.delete(userId,tenantId,brandId,asset.id,correlationId);await expect(service.download(userId,tenantId,brandId,asset.id)).rejects.toThrow('NOT_FOUND');
    // Make queued cleanup due on the database clock; host and Docker clocks can differ.
    await database.client`update media_assets set delete_after=now() where id=${asset.id}`;
    failDelete=true;expect(await service.cleanupOne()).toBe(true);failDelete=false;
    let [stored]=await database.client`select * from media_assets where id=${asset.id}`;expect(stored?.status).toBe('DELETE_PENDING');expect(stored?.delete_attempts).toBe(1);
    await database.client`update media_assets set delete_after=now() where id=${asset.id}`;
    expect(await service.cleanupOne()).toBe(true);[stored]=await database.client`select * from media_assets where id=${asset.id}`;expect(stored?.status).toBe('DELETED');expect(stored?.name).toBe('[deleted]');expect(objects.has(stored!.storage_key)).toBe(false);
    expect((await service.overview(userId,tenantId,brandId)).assets.some(row=>row.id===asset.id)).toBe(false);
    expect((await service.delete(userId,tenantId,brandId,asset.id,correlationId)).status).toBe('DELETED');
  });
  it('fences interrupted uploads and reclaims abandoned media after a day',async()=>{
    const request=input();failPut=true;await expect(service.upload(userId,tenantId,brandId,request,image,correlationId)).rejects.toThrow();failPut=false;
    const [asset]=await database.client`select id from media_assets where idempotency_key=${request.idempotencyKey}`;
    await database.client`update media_assets set created_at=now()-interval '2 days',lease_expires_at=now()-interval '2 hours' where id=${asset!.id}`;
    expect(await service.cleanupOne()).toBe(true);
    await expect(service.upload(userId,tenantId,brandId,request,image,correlationId)).rejects.toThrow('CONFLICT');
  });
  it('does not let an upload completion undo a concurrent deletion',async()=>{
    let deletedId='';
    const racingStorage:StorageProvider={...storage,put:async(key,bytes)=>{
      objects.set(key,bytes);
      const [row]=await database.client`select id from media_assets where storage_key=${key}`;deletedId=row!.id;
      await service.delete(userId,tenantId,brandId,deletedId,correlationId);
    }};
    const racing=new MediaService(repo,racingStorage,`fixture-${tenantId}`);
    await expect(racing.upload(userId,tenantId,brandId,input(),image,correlationId)).rejects.toThrow('CONFLICT');
    const [row]=await database.client`select status from media_assets where id=${deletedId}`;expect(row?.status).toBe('DELETE_PENDING');
    await expect(service.download(userId,tenantId,brandId,deletedId)).rejects.toThrow('NOT_FOUND');
  });
});
