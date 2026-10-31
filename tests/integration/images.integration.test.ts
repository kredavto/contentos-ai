import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {beforeAll,describe,it,expect} from 'vitest';
import {NotificationRepository,AdminFinanceRepository,ImageRepository,LedgerRepository} from '../../packages/db/src/index';
import {NotificationService} from '../../packages/core/src/notifications';
import {ImageService,ImageProcessor} from '../../packages/core/src/images';
import {ProviderRequestError,type ImageProvider,type StorageProvider} from '../../packages/types/src/index';
import {isolatedTestDatabase} from '../helpers/isolated-database';
import {seedDevelopment,demoIds} from '../../packages/db/src/development-seed';
const url=process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('durable tenant image lifecycle',()=>{
  const database=isolatedTestDatabase(url),repo=new ImageRepository(database.db),ledger=new LedgerRepository(database.db);
  const {user,tenant,brand}=demoIds,correlation=randomUUID(),editor=randomUUID(),viewer=randomUUID(),approver=randomUUID();
  const objects=new Map<string,Uint8Array>();let failDelete=false;let bytes:Buffer,calls=0,writes=0,mode:'ok'|'uncertain'|'reject'|'delete'|'disable'|'storage'='ok';
  const provider:ImageProvider={name:'fixture-image',model:'fixture-model',currency:'USD',async generate(_input,context){calls++;if(mode==='uncertain')throw new ProviderRequestError('RECONCILIATION_REQUIRED',503,false);if(mode==='reject')throw new ProviderRequestError('PROVIDER_REJECTED',502,true);if(mode==='delete')await repo.delete(user,tenant,brand,context.internalId);if(mode==='disable')await database.client`update users set disabled_at=now() where id=${user}`;return {reference:{provider:'fixture-image',internalId:context.internalId,externalId:'fixture-request',metadata:{}},bytes,mimeType:'image/png',usage:{model:'fixture-model',inputUnits:null,outputUnits:null,costMicrounits:null,currency:'USD'}};}};
  const storage:StorageProvider={async get(key){return objects.get(key)!;},async put(key,data){writes++;objects.set(key,data);if(mode==='storage')throw new Error('Acknowledgement lost');},async delete(key){if(failDelete)throw new Error('fixture deletion unavailable');objects.delete(key);},async signedDownload(key){return `https://storage.example.test/${key}`;}};
  const service=new ImageService(repo,provider,storage),processor=new ImageProcessor(repo,provider,storage);
  const request=()=>({name:'Fictional image',input:{prompt:'Fictional scene',width:1024,height:1024},idempotencyKey:randomUUID()});
  beforeAll(async()=>{
    await seedDevelopment(database.db,`scrypt:v1:${'0'.repeat(32)}:${'0'.repeat(128)}`);bytes=await sharp({create:{width:1024,height:1024,channels:3,background:'#cceedd'}}).png().withMetadata().toBuffer();
    for(const [id,role] of [[editor,'EDITOR'],[viewer,'VIEWER'],[approver,'CLIENT_APPROVER']] as const){await database.client`insert into users(id,email,password_hash,name,email_verified_at) values(${id},${`${id}@example.test`},'unusable','Image fixture',now())`;await database.client`insert into organization_members(tenant_id,user_id,role) values(${tenant},${id},${role})`;}
  });
  it('deduplicates concurrent actor intent, captures once, normalizes bytes and scopes approval/download',async()=>{
    const input=request(),start=calls;const pair=await Promise.all([service.request(user,tenant,brand,input,correlation),service.request(user,tenant,brand,input,correlation)]);const id=pair[0]!.id;expect(pair[1]!.id).toBe(id);
    await expect(service.request(editor,tenant,brand,input,correlation)).rejects.toThrow('CONFLICT');await expect(service.request(user,tenant,brand,{...input,name:'changed'},correlation)).rejects.toThrow('CONFLICT');
    await Promise.all([processor.run(tenant,id),processor.run(tenant,id)]);await processor.run(tenant,id);expect(calls-start).toBe(1);
    const [row]=await database.client`select * from generated_images where id=${id}`;expect(row?.status).toBe('READY');expect((await sharp(objects.get(row!.storage_key)!).metadata()).exif).toBeUndefined();expect(row?.usage.inputUnits).toBeNull();
    expect((await ledger.overview(user,tenant)).balances.AI_CREDITS).toEqual({available:91,reserved:0});
    const notices=new NotificationRepository(database.db);await notices.projectBatch(tenant);await notices.projectBatch(tenant);const inbox=await new NotificationService(notices).list(approver,tenant,{});expect(inbox.items.filter(item=>item.type==='CONTENT_APPROVAL_REQUIRED')).toHaveLength(1);expect(inbox.items.find(item=>item.type==='CONTENT_APPROVAL_REQUIRED')?.href).toContain('&tab=images');
    await expect(service.download(user,tenant,brand,id,true,correlation)).rejects.toThrow('CONFLICT');await expect(service.approve(editor,tenant,brand,id)).rejects.toThrow('NOT_AUTHORIZED');await service.approve(approver,tenant,brand,id);await service.approve(approver,tenant,brand,id);
    expect((await service.download(viewer,tenant,brand,id,true,correlation)).expiresInSeconds).toBe(60);
    await expect(service.download(user,tenant,randomUUID(),id,false,correlation)).rejects.toThrow('NOT_FOUND');await expect(service.overview(user,randomUUID(),brand)).rejects.toThrow('NOT_FOUND');await expect(service.request(viewer,tenant,brand,request(),correlation)).rejects.toThrow('NOT_AUTHORIZED');
    expect(JSON.stringify(await service.overview(viewer,tenant,brand))).not.toContain('storageKey');
    await expect(database.client`update generated_images set input='{}' where id=${id}`).rejects.toThrow('immutable');await expect(database.client`update generated_images set status='QUEUED' where id=${id}`).rejects.toThrow('reopened');await expect(database.client`delete from generated_images where id=${id}`).rejects.toThrow('cannot be deleted');
  });
  it('never replays an uncertain call and refunds only once',async()=>{
    mode='uncertain';const start=calls,balance=(await ledger.overview(user,tenant)).balances.AI_CREDITS.available;const job=await service.request(user,tenant,brand,request(),correlation);await processor.run(tenant,job.id);await processor.run(tenant,job.id);
    const [row]=await database.client`select * from generated_images where id=${job.id}`;expect(row?.status).toBe('RECONCILIATION');expect(row?.usage).toBeNull();expect(calls-start).toBe(1);expect((await ledger.overview(user,tenant)).balances.AI_CREDITS).toEqual({available:balance,reserved:0});mode='ok';
  });
  it('records definitive rejection as failed and does not send again',async()=>{
    mode='reject';const job=await service.request(user,tenant,brand,request(),correlation);await processor.run(tenant,job.id);expect((await database.client`select status from generated_images where id=${job.id}`)[0]?.status).toBe('FAILED');mode='ok';
  });
  it('recovers only pre-submission leases and fences an expired submission without another call',async()=>{
    const job=await service.request(user,tenant,brand,request(),correlation),first=await repo.claim(tenant,job.id);await database.client`update generated_images set lease_expires_at=now()-interval '1 second' where id=${job.id}`;
    const second=await repo.claim(tenant,job.id);expect(second?.attempt).toBe(2);await expect(repo.submit(first!)).rejects.toThrow('CONFLICT');await repo.submit(second!);
    await expect(database.client`update generated_images set status='RUNNING' where id=${job.id}`).rejects.toThrow('replayed');
    await database.client`update generated_images set lease_expires_at=now()-interval '1 second' where id=${job.id}`;const before=calls;await processor.run(tenant,job.id);expect(calls).toBe(before);expect((await database.client`select status from generated_images where id=${job.id}`)[0]?.status).toBe('RECONCILIATION');await expect(repo.complete(second!,{bytes:12,sha256:'0'.repeat(64)})).rejects.toThrow('CONFLICT');
  });
  it('cleans an orphaned acknowledged-lost write without generating again',async()=>{
    mode='storage';const job=await service.request(user,tenant,brand,request(),correlation),before=calls;await processor.run(tenant,job.id);mode='ok';
    const [row]=await database.client`select * from generated_images where id=${job.id}`;expect(row?.status).toBe('RECONCILIATION');expect(row?.usage).not.toBeNull();expect(objects.has(row!.storage_key)).toBe(true);
    await database.client`update generated_images set delete_after=case when id=${job.id} then now() else now()+interval '1 hour' end`;await processor.cleanupOne();expect(objects.has(row!.storage_key)).toBe(false);await processor.run(tenant,job.id);expect(calls-before).toBe(1);
  });
  it('deletion during a remote call prevents storage/capture and scrubs the prompt after durable cleanup',async()=>{
    mode='delete';const job=await service.request(user,tenant,brand,request(),correlation),before=writes;await processor.run(tenant,job.id);mode='ok';expect(writes).toBe(before);
    await expect(service.download(user,tenant,brand,job.id,false,correlation)).rejects.toThrow('NOT_FOUND');await expect(service.delete(viewer,tenant,brand,job.id)).rejects.toThrow('NOT_AUTHORIZED');
    await database.client`update generated_images set delete_after=case when id=${job.id} then now() else now()+interval '1 hour' end`;await processor.cleanupOne();const [row]=await database.client`select * from generated_images where id=${job.id}`;expect(row?.status).toBe('DELETED');expect(row?.input).toBeNull();expect(row?.name).toBe('[deleted]');expect((await ledger.overview(user,tenant)).balances.AI_CREDITS.reserved).toBe(0);
  });
  it('rechecks a revoked actor before storing and refuses disabled configuration before reservation',async()=>{
    mode='disable';const job=await service.request(user,tenant,brand,request(),correlation),before=writes;await processor.run(tenant,job.id);mode='ok';expect(writes).toBe(before);await database.client`update users set disabled_at=null where id=${user}`;
    expect((await database.client`select status from generated_images where id=${job.id}`)[0]?.status).toBe('RECONCILIATION');expect(()=>new ImageService(repo,null,storage).request(user,tenant,brand,request(),correlation)).toThrow('CONFIGURATION_REQUIRED');
  });
  it('includes uncertain and deleted submissions as unknown financial expense',async()=>{
    await database.client`insert into platform_operators(user_id,role) values(${user},'ADMIN')`;
    const report=await new AdminFinanceRepository(database.db).report(user,{from:new Date(Date.now()-86400000).toISOString(),to:new Date(Date.now()+86400000).toISOString(),tenantId:tenant,paymentMode:'LIVE',groupBy:'BRAND'},correlation);
    expect(report.costs.find(row=>row.currency==='USD')?.unknownCalls).toBe('7');expect(report.groups.find(row=>row.entityId===brand)?.calls).toBe('7');expect(report.grossMargin).toBeNull();
  });
  it('bounds queued work per tenant before spending extra credits',async()=>{
    const jobs=await Promise.all(Array.from({length:4},()=>service.request(user,tenant,brand,request(),correlation)));
    await expect(service.request(user,tenant,brand,request(),correlation)).rejects.toThrow('PLAN_LIMIT_REACHED');
    for(const job of jobs)await service.delete(user,tenant,brand,job.id);
    expect((await ledger.overview(user,tenant)).balances.AI_CREDITS.reserved).toBe(0);
  });

  it('retries deletion and sweeps late writes without refunding a captured result',async()=>{
    const job=await service.request(user,tenant,brand,request(),correlation);await processor.run(tenant,job.id);const balance=(await ledger.overview(user,tenant)).balances.AI_CREDITS.available;
    const [row]=await database.client`select * from generated_images where id=${job.id}`;await service.delete(user,tenant,brand,job.id);
    const due=()=>database.client`update generated_images set delete_after=case when id=${job.id} then now() else now()+interval '1 hour' end`;
    await due();failDelete=true;await processor.cleanupOne();expect((await database.client`select status from generated_images where id=${job.id}`)[0]?.status).toBe('DELETE_PENDING');
    failDelete=false;await due();await processor.cleanupOne();expect(objects.has(row!.storage_key)).toBe(false);
    objects.set(row!.storage_key,bytes);await due();await processor.cleanupOne();expect(objects.has(row!.storage_key)).toBe(false);expect((await ledger.overview(user,tenant)).balances.AI_CREDITS.available).toBe(balance);
  });

  it('keeps missing metering in the snapshotted billing currency and refuses changed routing',async()=>{
    const euro:ImageProvider={...provider,currency:'EUR',async generate(){throw new ProviderRequestError('RECONCILIATION_REQUIRED',503,false);}};
    const euroService=new ImageService(repo,euro,storage),euroProcessor=new ImageProcessor(repo,euro,storage);
    const stale=await euroService.request(user,tenant,brand,request(),correlation),before=calls;await processor.run(tenant,stale.id);expect(calls).toBe(before);
    const [failed]=await database.client`select status,submitted_at from generated_images where id=${stale.id}`;expect(failed?.status).toBe('FAILED');expect(failed?.submitted_at).toBeNull();
    const job=await euroService.request(user,tenant,brand,request(),correlation);await euroProcessor.run(tenant,job.id);
    const report=await new AdminFinanceRepository(database.db).report(user,{from:new Date(Date.now()-86400000).toISOString(),to:new Date(Date.now()+86400000).toISOString(),tenantId:tenant,paymentMode:'LIVE',groupBy:'PROVIDER'},correlation);
    expect(report.costs.find(row=>row.currency==='EUR')).toMatchObject({calls:'1',unknownCalls:'1',knownMicrounits:'0'});expect(report.groups.find(row=>row.currency==='EUR')?.entityId).toBe('fixture-image');
  });

});
