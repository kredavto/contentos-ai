import {randomUUID,randomBytes} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {AdminRepository} from '../../packages/db/src/index';
import {AdminService} from '../../packages/core/src/admin';
import {CredentialVault} from '../../packages/core/src/credential-vault';
import {isolatedTestDatabase} from '../helpers/isolated-database';
const url=process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('operator account deletion inventory',()=>{
 const database=isolatedTestDatabase(url),repository=new AdminRepository(database.db),service=new AdminService(repository,true,[]);
 async function fixture(){
  const actor=randomUUID(),subject=randomUUID(),other=randomUUID(),tenant=randomUUID(),workspace=randomUUID(),brand=randomUUID(),request=randomUUID();
  for(const id of [actor,subject,other])await database.client`insert into users(id,email,name,password_hash,email_verified_at) values(${id},${`${id}@example.test`},'Private fixture name','private-password-sentinel',now())`;
  await database.client`insert into platform_operators(user_id,role) values(${actor},'SUPPORT')`;
  await database.client`insert into organizations(id,name) values(${tenant},'Private organization')`;
  for(const [id,role] of [[subject,'OWNER'],[other,'EDITOR']])await database.client`insert into organization_members(tenant_id,user_id,role) values(${tenant},${id!},${role!})`;
  await database.client`insert into workspaces(id,tenant_id,name) values(${workspace},${tenant},'Fixture')`;
  await database.client`insert into brands(id,tenant_id,workspace_id,name) values(${brand},${tenant},${workspace},'Fixture')`;
  await database.client`insert into account_deletion_requests(id,user_id,request_key) values(${request},${subject},${randomUUID()})`;
  return {actor,subject,other,tenant,workspace,brand,request};
 }
 it('denies tenant owners and unavailable operators before looking up requests',async()=>{
  const f=await fixture();
  await expect(service.inspectDeletion(f.subject,f.request,randomUUID())).rejects.toThrow('NOT_AUTHORIZED');
  await expect(service.inspectDeletion(f.subject,randomUUID(),randomUUID())).rejects.toThrow('NOT_AUTHORIZED');
  await expect(service.inspectDeletion(f.actor,randomUUID(),randomUUID())).rejects.toThrow('NOT_FOUND');
  expect(()=>new AdminService(repository,false,[]).inspectDeletion(f.actor,f.request,randomUUID())).toThrow('CONFIGURATION_REQUIRED');
  expect(()=>service.inspectDeletion(f.actor,'invalid',randomUUID())).toThrow();
  for(const update of ['unverified','disabled','revoked']){
   await database.client`update users set email_verified_at=${update==='unverified'?null:new Date().toISOString()},disabled_at=${update==='disabled'?new Date().toISOString():null} where id=${f.actor}`;
   await database.client`update platform_operators set revoked_at=${update==='revoked'?new Date().toISOString():null} where user_id=${f.actor}`;
   await expect(service.inspectDeletion(f.actor,f.request,randomUUID())).rejects.toThrow('NOT_AUTHORIZED');
  }
  expect(await database.client`select id from audit_logs where resource_id=${f.request}`).toHaveLength(0);
 });
 it('reports exact actor-linked counts without secrets or treating them as deletion permission',async()=>{
  const f=await fixture(),vault=new CredentialVault(JSON.stringify({v1:randomBytes(32).toString('base64')}),'v1'),key=randomUUID();
  const credential=vault.encrypt('fixture-only-private-key',{kind:'PROVIDER_KEY',tenantId:f.tenant,brandId:f.brand,connectionId:key,provider:'heygen'});
  await database.client`insert into provider_keys(id,tenant_id,brand_id,provider,credential,masked_key,status,created_by) values(${key},${f.tenant},${f.brand},'heygen',${JSON.stringify(credential)}::jsonb,'••••••••test','ACTIVE',${f.subject})`;
  for(const [u,status] of [[f.subject,'READY'],[f.subject,'DELETED'],[f.other,'READY']]){
   const id=randomUUID();await database.client`insert into media_assets(id,tenant_id,brand_id,uploaded_by,name,status,provider,storage_key,mime_type,bytes,width,height,sha256,input_hash,idempotency_key,correlation_id) values(${id},${f.tenant},${f.brand},${u!},'private-photo-name',${status!},'s3',${`${f.tenant}/private-photo-${id}`},'image/jpeg',123,10,10,${'a'.repeat(64)},${'b'.repeat(64)},${randomUUID()},${randomUUID()})`;
  }
  for(const [u,status] of [[f.subject,'QUEUED'],[f.subject,'RECONCILIATION'],[f.subject,'SUCCEEDED'],[f.other,'QUEUED']]){
   const reservation=randomUUID();await database.client`insert into usage_reservations(id,tenant_id,key,unit,amount) values(${reservation},${f.tenant},${reservation},'AI_CREDITS',1)`;
   await database.client`insert into jobs(tenant_id,brand_id,requested_by,type,status,input,input_hash,idempotency_key,reservation_id,provider,model,correlation_id) values(${f.tenant},${f.brand},${u!},'GENERATE_SCRIPT',${status!},'{"private":"private-input-sentinel"}'::jsonb,${'c'.repeat(64)},${randomUUID()},${reservation},'fixture','fixture',${randomUUID()})`;
  }
  await database.client`insert into sessions(user_id,token_hash,expires_at) values(${f.subject},${randomUUID()},now()+interval '1 hour'),(${f.subject},${randomUUID()},now()-interval '1 hour')`;
  const result=await service.inspectDeletion(f.actor,f.request,randomUUID());
  expect(result.inventory).toEqual({memberships:'1',ownedOrganizations:'1',activeSessions:'1',pendingGenerationJobs:'2',generationReconciliation:'1',photoUploads:'1',libraryUploads:'0',socialConnectionsCreated:'0',providerKeysCreated:'1',consentEvidence:'0',renewalEvidence:'0',pendingAuthEmails:'0',pendingNotificationEmails:'0'});
  expect(result.executionAvailable).toBe(false);expect(result.request.status).toBe('REQUESTED');
  for(const secret of ['private-input-sentinel','private-password-sentinel','private-photo-name','fixture-only-private-key','••••••••test',credential.ciphertext])expect(JSON.stringify(result)).not.toContain(secret);
  const [audit]=await database.client`select action,metadata from audit_logs where resource_id=${f.request}`;expect(audit).toEqual({action:'ADMIN_DELETION_INSPECTED',metadata:{}});
  await database.client`delete from organization_members where tenant_id=${f.tenant} and user_id=${f.subject}`;
  const after=await service.inspectDeletion(f.actor,f.request,randomUUID());expect(after.inventory.memberships).toBe('0');expect(after.inventory.providerKeysCreated).toBe('1');expect(after.inventory.photoUploads).toBe('1');
  expect((await database.client`select status from provider_keys where id=${key}`)[0]?.status).toBe('ACTIVE');expect((await database.client`select disabled_at from users where id=${f.subject}`)[0]?.disabled_at).toBeNull();
 });
 it('refreshes cancelled request state without authorizing cleanup or changing revisions',async()=>{
  const f=await fixture(),before=await service.inspectDeletion(f.actor,f.request,randomUUID()),revision=randomUUID();
  await database.client`update account_deletion_requests set status='CANCELLED',cancelled_at=now(),revision=${revision} where id=${f.request}`;
  const after=await service.inspectDeletion(f.actor,f.request,randomUUID());expect(after.request.status).toBe('CANCELLED');expect(after.request.revision).toBe(revision);expect(after.request.revision).not.toBe(before.request.revision);expect(after.executionAvailable).toBe(false);
 });
});
