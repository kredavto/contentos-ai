import {randomUUID} from 'node:crypto';
import {beforeAll,afterAll,describe,expect,it} from 'vitest';
import {createDatabase,ConsentRepository,requireConsent} from '../../packages/db/src/index';
import {ConsentService,consentPolicy} from '../../packages/core/src/consent';
const url=process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('subject-scoped consent evidence',()=>{
  if(url&&!new URL(url).pathname.endsWith('_test'))throw new Error('Dedicated test database required');
  const database=createDatabase(url??'postgresql://localhost/unused_test');const service=new ConsentService(new ConsentRepository(database.db));
  const tenantId=randomUUID(),userId=randomUUID(),otherUserId=randomUUID(),workspaceId=randomUUID(),brandId=randomUUID(),correlationId=randomUUID();let subjectId='',recordId='';
  const policy=consentPolicy('OWN_LIKENESS');const key=randomUUID();
  const input=()=>({subjectId,type:policy.type,version:policy.version,textHash:policy.textHash,accepted:true,idempotencyKey:key});
  beforeAll(async()=>{
    await database.client`insert into users(id,email,password_hash,name,email_verified_at) values(${userId},${`consent-${userId}@example.test`},'test-unusable','Fictional owner',now()),(${otherUserId},${`consent-${otherUserId}@example.test`},'test-unusable','Fictional viewer',now())`;
    await database.client`insert into organizations(id,name) values(${tenantId},'Consent tests')`;
    await database.client`insert into organization_members(tenant_id,user_id,role) values(${tenantId},${userId},'OWNER'),(${tenantId},${otherUserId},'VIEWER')`;
    await database.client`insert into workspaces(id,tenant_id,name) values(${workspaceId},${tenantId},'Test workspace')`;
    await database.client`insert into brands(id,tenant_id,workspace_id,name) values(${brandId},${tenantId},${workspaceId},'Test brand')`;
    subjectId=(await service.createSubject(userId,tenantId,brandId,{name:'Fictional person',type:'PERSON'},correlationId)).id;
  });
  afterAll(()=>database.close());
  it('rejects absent consent, stale policy and unauthorized acceptance',async()=>{
    await expect(database.db.transaction(tx=>requireConsent(tx,tenantId,subjectId,[policy]))).rejects.toThrow('CONSENT_REQUIRED');
    expect(()=>service.accept(userId,tenantId,brandId,{...input(),version:'old'}, {ip:'127.0.0.1',userAgent:'test'},correlationId)).toThrow('CONFLICT');
    await expect(service.accept(otherUserId,tenantId,brandId,input(),{ip:'127.0.0.1',userAgent:'test'},correlationId)).rejects.toThrow('NOT_AUTHORIZED');
  });
  it('records evidence once and checks exact subject, type and policy',async()=>{
    const records=await Promise.all([service.accept(userId,tenantId,brandId,input(),{ip:'127.0.0.1',userAgent:'test'},correlationId),service.accept(userId,tenantId,brandId,input(),{ip:'127.0.0.1',userAgent:'test'},correlationId)]);
    recordId=records[0]!.id;expect(records[1]!.id).toBe(recordId);
    await database.db.transaction(tx=>requireConsent(tx,tenantId,subjectId,[policy]));
    await expect(database.db.transaction(tx=>requireConsent(tx,tenantId,randomUUID(),[policy]))).rejects.toThrow('CONSENT_REQUIRED');
    await expect(database.db.transaction(tx=>requireConsent(tx,tenantId,subjectId,[consentPolicy('VOICE_CLONING')]))).rejects.toThrow('CONSENT_REQUIRED');
    const overview=await service.overview(userId,tenantId,brandId);expect(JSON.stringify(overview.records)).not.toContain('127.0.0.1');
    await expect(database.client`update consent_records set subject_name='Changed' where id=${recordId}`).rejects.toThrow('immutable');
  });
  it('allows irrevocable withdrawal, rejects outsiders, and never reactivates through replay',async()=>{
    await expect(service.revoke(otherUserId,tenantId,brandId,recordId,correlationId)).rejects.toThrow('NOT_AUTHORIZED');
    await service.accept(userId,tenantId,brandId,{...input(),idempotencyKey:randomUUID()},{ip:'127.0.0.1',userAgent:'test'},correlationId);
    await service.revoke(userId,tenantId,brandId,recordId,correlationId);await service.revoke(userId,tenantId,brandId,recordId,correlationId);
    expect((await service.accept(userId,tenantId,brandId,input(),{ip:'127.0.0.1',userAgent:'test'},correlationId)).revokedAt).not.toBeNull();
    await expect(database.db.transaction(tx=>requireConsent(tx,tenantId,subjectId,[policy]))).rejects.toThrow('CONSENT_REQUIRED');
    await expect(database.client`update consent_records set revoked_at=null,revoked_by_user_id=null where id=${recordId}`).rejects.toThrow('immutable');
    await expect(service.overview(randomUUID(),tenantId,brandId)).rejects.toThrow('NOT_FOUND');
  });
});
