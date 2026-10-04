import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createDatabase, JobRepository, LedgerRepository, ContentRepository } from '../../packages/db/src/index';
import { emptyOnboarding, generationOptionsSchema } from '../../packages/types/src/index';
const url=process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('durable generation state machine',()=>{
  if(url&&!new URL(url).pathname.endsWith('_test'))throw new Error('Dedicated test database required');
  const database=createDatabase(url??'postgresql://localhost/unused_test');
  const repository=new JobRepository(database.db);const ledger=new LedgerRepository(database.db);const content=new ContentRepository(database.db);
  const tenantId=randomUUID(),userId=randomUUID(),workspaceId=randomUUID(),brandId=randomUUID(),correlationId=randomUUID();
  const input={brain:emptyOnboarding('Fictional job brand'),options:generationOptionsSchema.parse({}),brandRevision:0};
  const output={hook:'Test hook',context:'Context',core:'Core',proof:'Verify this',cta:'Learn more',factCheckNotes:[]};
  const enqueue=(key=randomUUID())=>repository.enqueue(userId,tenantId,brandId,'GENERATE_SCRIPT',input,key,'mock','mock-v1',correlationId);
  beforeAll(async()=>{
    await database.client`insert into users(id,email,password_hash,name,email_verified_at) values(${userId},${`jobs-${userId}@example.test`},'test-unusable','Fictional author',now())`;
    await database.client`insert into organizations(id,name) values(${tenantId},'Job tests')`;
    await database.client`insert into organization_members(tenant_id,user_id,role) values(${tenantId},${userId},'OWNER')`;
    await database.client`insert into workspaces(id,tenant_id,name) values(${workspaceId},${tenantId},'Test workspace')`;
    await database.client`insert into brands(id,tenant_id,workspace_id,name,onboarding_completed_at) values(${brandId},${tenantId},${workspaceId},'Test brand',now())`;
    await ledger.adjust(tenantId,'AI_CREDITS',100,'test-funding',correlationId);
  });
  afterAll(()=>database.close());
  it('atomically reserves, enqueues and writes outbox once for concurrent replay',async()=>{
    const key=randomUUID();const results=await Promise.all([enqueue(key),enqueue(key)]);
    expect(results[0]?.id).toBe(results[1]?.id);
    const rows=await database.client`select id from outbox where job_id=${results[0]!.id}`;expect(rows).toHaveLength(1);
    await expect(repository.enqueue(userId,tenantId,brandId,'GENERATE_SCRIPT',{...input,options:{...input.options,topic:'Changed'}},key,'mock','mock-v1',correlationId)).rejects.toThrow('CONFLICT');
    const claimed=await repository.claim(tenantId,results[0]!.id);expect(claimed?.attempt).toBe(1);
    expect(await repository.claim(tenantId,results[0]!.id)).toBeNull();
    await repository.complete(tenantId,claimed!.id,claimed!.leaseToken!,output);
    expect(await repository.claim(tenantId,claimed!.id)).toBeNull();
    await expect(repository.complete(tenantId,claimed!.id,claimed!.leaseToken!,output)).rejects.toThrow('CONFLICT');
    expect((await ledger.overview(userId,tenantId)).balances.AI_CREDITS).toEqual({available:98,reserved:0});
  });
  it('fences a lost lease and releases credits after permanent failure',async()=>{
    const job=await enqueue();const first=await repository.claim(tenantId,job.id);
    await database.client`update jobs set lease_expires_at=now()-interval '1 second' where id=${job.id}`;
    const replacement=await repository.claim(tenantId,job.id);expect(replacement?.attempt).toBe(2);
    expect(await repository.heartbeat(tenantId,job.id,first!.leaseToken!)).toBe(false);
    await expect(repository.complete(tenantId,job.id,first!.leaseToken!,output)).rejects.toThrow('CONFLICT');
    await repository.fail(tenantId,job.id,replacement!.leaseToken!,'PROVIDER_REJECTED',false);
    expect((await ledger.overview(userId,tenantId)).balances.AI_CREDITS).toEqual({available:98,reserved:0});
  });
  it('persists exponential retries and releases on attempt exhaustion',async()=>{
    const job=await enqueue();
    for(let attempt=1;attempt<=3;attempt++){
      const claimed=await repository.claim(tenantId,job.id);expect(claimed?.attempt).toBe(attempt);
      await repository.fail(tenantId,job.id,claimed!.leaseToken!,'PROVIDER_UNAVAILABLE',true);
      const [row]=await database.client`select status,next_attempt_at from jobs where id=${job.id}`;
      expect(row?.status).toBe(attempt<3?'RETRY':'FAILED');
      if(attempt<3){expect(new Date(row!.next_attempt_at).getTime()-Date.now()).toBeGreaterThan(4000*2**(attempt-1));expect(await repository.claim(tenantId,job.id)).toBeNull();await database.client`update jobs set next_attempt_at=now()-interval '1 second' where id=${job.id}`;}
    }
    expect((await ledger.overview(userId,tenantId)).balances.AI_CREDITS.reserved).toBe(0);
  });
  it('rechecks permission before committing a generated result',async()=>{
    const job=await enqueue();const claimed=await repository.claim(tenantId,job.id);
    await database.client`update organization_members set role='VIEWER' where tenant_id=${tenantId} and user_id=${userId}`;
    await expect(repository.complete(tenantId,job.id,claimed!.leaseToken!,output)).rejects.toThrow('NOT_AUTHORIZED');
    await repository.fail(tenantId,job.id,claimed!.leaseToken!,'NOT_AUTHORIZED',false);
    await database.client`update organization_members set role='OWNER' where tenant_id=${tenantId} and user_id=${userId}`;
  });
  it('keeps immutable script history and invalidates approval after editing',async()=>{
    const overview=await content.overview(userId,tenantId,brandId);const script=overview.scripts[0]!;
    await content.editScript(userId,tenantId,brandId,script.id,1,null,correlationId);
    expect((await content.overview(userId,tenantId,brandId)).scripts[0]?.approvedVersion).toBe(1);
    await content.editScript(userId,tenantId,brandId,script.id,1,{...output,hook:'Edited'},correlationId);
    expect((await content.overview(userId,tenantId,brandId)).scripts[0]?.approvedVersion).toBeNull();
    await expect(content.editScript(userId,tenantId,brandId,script.id,1,null,correlationId)).rejects.toThrow('CONFLICT');
    const history=await content.history(userId,tenantId,brandId,script.id);expect(history.map(row=>row.version)).toEqual([2,1]);
    await expect(database.client`delete from script_versions where script_id=${script.id}`).rejects.toThrow('Append-only');
    await expect(content.history(randomUUID(),tenantId,brandId,script.id)).rejects.toThrow('NOT_FOUND');
  });
});
