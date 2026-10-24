import {randomUUID} from 'node:crypto';
import {beforeAll,describe,expect,it} from 'vitest';
import {ApprovalRepository,ImageRepository} from '../../packages/db/src/index';
import {ApprovalService} from '../../packages/core/src/approvals';
import type {StorageProvider} from '../../packages/types/src/index';
import {isolatedTestDatabase} from '../helpers/isolated-database';
import {seedDevelopment,demoIds} from '../../packages/db/src/development-seed';
const url=process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('assigned image approval and private previews',()=>{
  const database=isolatedTestDatabase(url),repo=new ApprovalRepository(database.db),images=new ImageRepository(database.db);
  const {tenant,brand,user}=demoIds,reviewer=randomUUID(),viewer=randomUUID(),correlation=randomUUID();
  let onSign:(()=>Promise<void>)|null=null,signs=0;
  const storage:StorageProvider={async get(){return new Uint8Array();},async put(){},async delete(){},async signedDownload(){signs++;await onSign?.();return 'https://storage.example.test/signed-preview';}};
  const service=new ApprovalService(repo,storage);
  beforeAll(async()=>{
    await seedDevelopment(database.db,`scrypt:v1:${'0'.repeat(32)}:${'0'.repeat(128)}`);
    for(const [id,role] of [[reviewer,'CLIENT_APPROVER'],[viewer,'VIEWER']] as const){await database.client`insert into users(id,email,name,password_hash,email_verified_at) values(${id},${`${id}@example.test`},'Reviewer','unusable',now())`;await database.client`insert into organization_members(tenant_id,user_id,role) values(${tenant},${id},${role})`;}
  });
  async function image(){
    const job=await images.request(user,tenant,brand,{name:'Approval image',input:{prompt:'Fixture image',width:1024,height:1024},idempotencyKey:randomUUID()},'fixture','fixture','USD',correlation);
    const claimed=(await images.claim(tenant,job.id))!;await images.submit(claimed);await images.metering(claimed,{model:'fixture',inputUnits:null,outputUnits:null,costMicrounits:null,currency:'USD'},null);await images.complete(claimed,{bytes:1024,sha256:'a'.repeat(64)});
    return {imageId:job.id,version:1,requestedFrom:reviewer,idempotencyKey:randomUUID()};
  }
  it('captures immutable hash, deduplicates concurrent approval and does not expose keys',async()=>{
    const input=await image(),[request,retry]=await Promise.all([service.create(user,tenant,brand,input,correlation),service.create(user,tenant,brand,input,correlation)]);expect(request).toEqual(retry);
    const row=(await service.list(reviewer,tenant,{})).items.find(item=>item.id===request.id)!;expect(row.entityType).toBe('IMAGE');expect(row.content).toBeNull();expect(row.targetChanged).toBe(false);expect(JSON.stringify(row)).not.toMatch(/storageKey|mediaHash|requestedMediaHash/);
    expect(await service.preview(reviewer,tenant,request.id,correlation)).toEqual({url:'https://storage.example.test/signed-preview',expiresInSeconds:60});
    await expect(database.client`update approval_requests set media_hash=${'b'.repeat(64)} where id=${request.id}`).rejects.toThrow('immutable');
    await Promise.all([service.decide(reviewer,tenant,request.id,{status:'APPROVED'},correlation),service.decide(reviewer,tenant,request.id,{status:'APPROVED'},correlation)]);
    expect((await database.client`select approved_by from generated_images where id=${input.imageId}`)[0]?.approved_by).toBe(reviewer);
    expect((await database.client`select count(*)::int as n from audit_logs where resource_id=${input.imageId} and action='IMAGE_APPROVED'`)[0]?.n).toBe(1);
  });
  it('rejects foreign tenants, unrelated viewers and unassigned decisions before signing',async()=>{
    const input=await image(),request=await service.create(user,tenant,brand,input,correlation),before=signs;
    await expect(service.preview(viewer,tenant,request.id,correlation)).rejects.toThrow('NOT_FOUND');await expect(service.preview(reviewer,randomUUID(),request.id,correlation)).rejects.toThrow('NOT_FOUND');expect(signs).toBe(before);
    await expect(service.decide(user,tenant,request.id,{status:'APPROVED'},correlation)).rejects.toThrow('NOT_AUTHORIZED');
    await expect(service.create(user,tenant,randomUUID(),{...input,idempotencyKey:randomUUID()},correlation)).rejects.toThrow('NOT_FOUND');
    await expect(new ApprovalService(repo).preview(reviewer,tenant,request.id,correlation)).rejects.toThrow('CONFIGURATION_REQUIRED');
  });
  it('protects the file hash and fences deletion while preserving a cancellable request',async()=>{
    const input=await image(),request=await service.create(user,tenant,brand,input,correlation);
    await expect(database.client`update generated_images set sha256=${'b'.repeat(64)} where id=${input.imageId}`).rejects.toThrow('immutable');
    await images.delete(user,tenant,brand,input.imageId);await expect(service.preview(reviewer,tenant,request.id,correlation)).rejects.toThrow('CONFLICT');
    await expect(service.decide(reviewer,tenant,request.id,{status:'APPROVED'},correlation)).rejects.toThrow('CONFLICT');
    await database.client`update generated_images set delete_after=now() where id=${input.imageId}`;const cleanup=(await images.claimCleanup())!;await images.cleanupFinished(cleanup,true);
    const deleted=(await service.list(reviewer,tenant,{})).items.find(item=>item.id===request.id)!;expect(deleted.targetChanged).toBe(true);expect(deleted.title).toBe('[deleted]');
    await service.decide(user,tenant,request.id,{status:'CANCELLED'},correlation);
    expect((await database.client`select approved_at from generated_images where id=${input.imageId}`)[0]?.approved_at).toBeNull();
  });
  it('rechecks deletion and current membership after storage signing',async()=>{
    const input=await image(),request=await service.create(user,tenant,brand,input,correlation);
    onSign=()=>images.delete(user,tenant,brand,input.imageId).then(()=>undefined);
    await expect(service.preview(reviewer,tenant,request.id,correlation)).rejects.toThrow('CONFLICT');onSign=null;
    const second=await service.create(user,tenant,brand,await image(),correlation);
    onSign=async()=>{await database.client`update users set disabled_at=now() where id=${reviewer}`;};
    try{await expect(service.preview(reviewer,tenant,second.id,correlation)).rejects.toThrow();}finally{onSign=null;await database.client`update users set disabled_at=null where id=${reviewer}`;}
  });
});
