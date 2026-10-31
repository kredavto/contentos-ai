import {randomUUID} from 'node:crypto';
import {beforeAll,describe,expect,it,vi} from 'vitest';
import {AccountErasureRepository,PrivacyRepository,BrandRepository,AuthRepository} from '../../packages/db/src/index';
import {AccountErasureService} from '../../packages/core/src/account-erasures';
import {PrivacyService} from '../../packages/core/src/privacy';
import {hashPassword} from '../../packages/core/src/password';
import {isolatedTestDatabase} from '../helpers/isolated-database';
const url=process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('explicit account authentication-data erasure',()=>{
 const database=isolatedTestDatabase(url),repository=new AccountErasureRepository(database.db),privacy=new PrivacyRepository(database.db),service=new AccountErasureService(repository,privacy,true),intake=new PrivacyService(privacy);
 const password='Disposable erasure fixture 123!';let proof='';
 beforeAll(async()=>{proof=await hashPassword(password);});
 async function fixture(){const id=randomUUID(),email=id+'@example.test',tokenHash=randomUUID();
  await database.client`insert into users(id,email,name,password_hash,email_verified_at) values(${id},${email},'Private fixture name',${proof},now())`;
  await database.client`insert into sessions(user_id,token_hash,expires_at) values(${id},${randomUUID()},now()+interval '1 hour')`;
  await database.client`insert into auth_tokens(user_id,token_hash,type,expires_at) values(${id},${tokenHash},'RESET_PASSWORD',now()+interval '1 hour')`;
  const mail=randomUUID();await database.client`insert into email_outbox(id,user_id,token_hash,payload,correlation_id) values(${mail},${id},${tokenHash},'{"testOnly":true}'::jsonb,${randomUUID()})`;
  const request=await intake.request(id,{password,acknowledged:true,idempotencyKey:randomUUID()},randomUUID());
  const input={password,requestId:request.id,revision:request.revision,idempotencyKey:randomUUID(),scope:'ACCOUNT_AUTH_DATA_V1',acknowledgeIrreversible:true,acknowledgeRetainedEvidence:true};
  return {id,email,tokenHash,mail,request,input,confirm:()=>service.request(id,input,randomUUID())};
 }
 it('does not treat old intake as execution consent and requires all new acknowledgments',async()=>{
  const f=await fixture();expect(await repository.due()).toBeNull();
  for(const raw of [{...f.input,acknowledgeIrreversible:false},{...f.input,acknowledgeRetainedEvidence:false},{...f.input,scope:'ALL_DATA'},{...f.input,password:'wrong'}])await expect(service.request(f.id,raw,randomUUID())).rejects.toThrow();
  expect(await database.client`select id from account_erasures where user_id=${f.id}`).toHaveLength(0);
  expect(await database.client`select id from sessions where user_id=${f.id}`).toHaveLength(1);
 });
 it('atomically closes access, invalidates tokens and clears pending encrypted mail before queued erasure',async()=>{
  const f=await fixture();expect(await service.eligibility(f.id)).toMatchObject({available:true,eligible:true});
  const execution=await f.confirm();expect(execution.status).toBe('QUEUED');
  expect(await database.client`select id from users where id=${f.id} and disabled_at is not null and erased_at is null and email=${f.email}`).toHaveLength(1);
  expect(await database.client`select id from sessions where user_id=${f.id}`).toHaveLength(0);
  expect((await database.client`select consumed_at from auth_tokens where user_id=${f.id}`)[0]?.consumed_at).not.toBeNull();
  expect((await database.client`select status,payload from email_outbox where id=${f.mail}`)[0]).toEqual({status:'CANCELED',payload:null});
  expect(await new AuthRepository(database.db).createSession(f.id,proof,randomUUID(),new Date(Date.now()+10000),randomUUID())).toBe(false);
 });
 it('deduplicates confirmations and serializes two workers without duplicate completion audit',async()=>{
  const f=await fixture(),results=await Promise.all([repository.request(f.id,proof,f.input,randomUUID()),repository.request(f.id,proof,f.input,randomUUID())]);
  expect(results[0]).toEqual(results[1]);const id=results[0]!.id;
  await Promise.all([repository.execute(id),repository.execute(id)]);
  const [user]=await database.client`select email,name,password_hash,email_verified_at,disabled_at,erased_at from users where id=${f.id}`;
  expect(user).toMatchObject({email:`deleted+${f.id}@account.invalid`,name:'Удалённый аккаунт',password_hash:`ERASED:${f.id}`,email_verified_at:null});expect(user?.erased_at).not.toBeNull();
  expect(await database.client`select id from auth_tokens where user_id=${f.id}`).toHaveLength(0);expect(await database.client`select id from email_outbox where user_id=${f.id}`).toHaveLength(0);
  expect((await database.client`select status from account_erasures where id=${id}`)[0]?.status).toBe('COMPLETED');
  expect(await database.client`select id from audit_logs where user_id=${f.id} and action='ACCOUNT_AUTH_ERASURE_COMPLETED'`).toHaveLength(1);
  expect(await database.client`select id from account_deletion_requests where id=${f.request.id}`).toHaveLength(1);
  await expect(database.client`update users set email=${f.email},disabled_at=null where id=${f.id}`).rejects.toThrow();
  await expect(database.client`delete from account_erasures where id=${id}`).rejects.toThrow();
 });
 it('preserves organizations and refuses accounts with ownership or memberships',async()=>{
  const f=await fixture(),organization=await new BrandRepository(database.db).createOrganization(f.id,'Shared data remains','UTC',randomUUID());
  expect(await repository.eligibility(f.id)).toMatchObject({eligible:false,resourceReview:true});await expect(f.confirm()).rejects.toThrow('CONFLICT');
  expect(await database.client`select id from organizations where id=${organization.id}`).toHaveLength(1);expect(await database.client`select id from users where id=${f.id} and disabled_at is null`).toHaveLength(1);
 });
 it('fails closed for new product foreign keys and identifier quoting rather than using an incomplete whitelist',async()=>{
  const f=await fixture();await database.client`create table "future user data" ("subject user" uuid references users(id), payload text)`;
  try{await database.client`insert into "future user data" values(${f.id},'Must remain')`;expect((await repository.eligibility(f.id)).eligible).toBe(false);await expect(f.confirm()).rejects.toThrow('CONFLICT');}
  finally{await database.client`drop table "future user data"`;}
 });
 it('does not erase identity when a dependency appears after confirmation',async()=>{
  const f=await fixture(),execution=await f.confirm();await database.client`create table late_user_reference (user_id uuid references users(id))`;
  try{await database.client`insert into late_user_reference values(${f.id})`;await repository.execute(execution.id);
   expect((await database.client`select status,error_code from account_erasures where id=${execution.id}`)[0]).toEqual({status:'BLOCKED',error_code:'RESOURCE_REVIEW_REQUIRED'});
   expect(await database.client`select id from users where id=${f.id} and email=${f.email} and erased_at is null`).toHaveLength(1);
  }finally{await database.client`drop table late_user_reference`;}
 });
 it('requires review of uncertain or in-flight mail instead of removing dispatch evidence',async()=>{
  for(const state of ['SENDING','RECONCILIATION']){
   const f=await fixture();if(state==='SENDING')await database.client`update email_outbox set status='SENDING',lease_token=${randomUUID()},lease_until=now()+interval '1 minute',submitted_at=now() where id=${f.mail}`;
   else await database.client`update email_outbox set status='RECONCILIATION',payload=null,submitted_at=now() where id=${f.mail}`;
   expect(await repository.eligibility(f.id)).toMatchObject({eligible:false,mailReview:true});await expect(f.confirm()).rejects.toThrow('CONFLICT');expect(await database.client`select id from email_outbox where id=${f.mail}`).toHaveLength(1);
  }
 });
 it('fences a canceled erasure intake',async()=>{
  const f=await fixture();await intake.cancel(f.id,{requestId:f.request.id,revision:f.request.revision},randomUUID());await expect(f.confirm()).rejects.toThrow('CONFLICT');
 });
 it('fences a changed password proof',async()=>{
  const f=await fixture();await database.client`update users set password_hash='changed' where id=${f.id}`;await expect(repository.request(f.id,proof,f.input,randomUUID())).rejects.toThrow('NOT_AUTHORIZED');
 });
 it('rejects another account erasure intake',async()=>{
  const f=await fixture(),other=await fixture();await expect(repository.request(other.id,proof,{...other.input,requestId:f.request.id},randomUUID())).rejects.toThrow('CONFLICT');
 });
 it('blocks stale-session organization creation and late membership insertion after access closure',async()=>{
  const f=await fixture();await f.confirm();const other=await fixture(),organization=await new BrandRepository(database.db).createOrganization(other.id,'Other organization','UTC',randomUUID());
  await expect(new BrandRepository(database.db).createOrganization(f.id,'Must not be created','UTC',randomUUID())).rejects.toThrow('NOT_AUTHORIZED');
  await expect(database.client`insert into organization_members(tenant_id,user_id,role) values(${organization.id},${f.id},'VIEWER')`).rejects.toThrow();
 });
 it('enforces the confirmed request subject in the database even if a future caller is mis-scoped',async()=>{
  const f=await fixture(),g=await fixture();
  await expect(database.client`insert into account_erasures(user_id,request_id,request_key,consent_version,correlation_id) values(${f.id},${g.request.id},${randomUUID()},'ACCOUNT_AUTH_DATA_V1',${randomUUID()})`).rejects.toThrow();
  expect(await database.client`select id from account_erasures where user_id=${f.id}`).toHaveLength(0);
 });

 it('reserves erased identity addresses in the database while allowing the real erasure transition',async()=>{
  const f=await fixture();await expect(database.client`insert into users(id,email,name,password_hash) values(${randomUUID()},${`deleted+${f.id}@account.invalid`},'Address squatter','unusable')`).rejects.toThrow();
  const execution=await f.confirm();await repository.execute(execution.id);expect((await database.client`select status from account_erasures where id=${execution.id}`)[0]?.status).toBe('COMPLETED');
 });

 it('does not deadlock confirmation with the mail delivery receipt transaction',async()=>{
  const f=await fixture(),lease=randomUUID();await database.client`update email_outbox set status='SENDING',lease_token=${lease},lease_until=now()+interval '1 minute',submitted_at=now() where id=${f.mail}`;
  let ready!:()=>void,release!:()=>void;const locked=new Promise<void>(resolve=>{ready=resolve;}),proceed=new Promise<void>(resolve=>{release=resolve;});
  const sender=database.client.begin(async tx=>{
   await tx`select id from email_outbox where id=${f.mail} for update`;ready();await proceed;
   await tx`update email_outbox set status='SENT',payload=null,lease_token=null,lease_until=null,completed_at=now() where id=${f.mail}`;
   await tx`insert into audit_logs(user_id,resource_id,action,correlation_id) values(${f.id},${f.mail},'AUTH_EMAIL_DELIVERED',${randomUUID()})`;
  });
  await locked;const confirmation=repository.request(f.id,proof,f.input,randomUUID());
  try{
   await vi.waitFor(async()=>{try{await database.client.begin(async tx=>{await tx`select id from users where id=${f.id} for update nowait`;});throw new Error('User lock not acquired yet');}catch(error){expect(error).toMatchObject({code:'55P03'});}},{timeout:2000,interval:10});
   release();const [delivered,confirmed]=await Promise.allSettled([sender,confirmation]);expect(delivered.status).toBe('fulfilled');
   expect((await database.client`select status from email_outbox where id=${f.mail}`)[0]?.status).toBe('SENT');
   if(confirmed.status==='rejected'){
    expect(confirmed.reason).toMatchObject({code:'CONFLICT'});
    expect(await database.client`select id from account_erasures where user_id=${f.id}`).toHaveLength(0);
    expect(await database.client`select id from users where id=${f.id} and disabled_at is null`).toHaveLength(1);
   }
   const execution=confirmed.status==='fulfilled'?confirmed.value:await repository.request(f.id,proof,f.input,randomUUID());
   expect(execution.status).toBe('QUEUED');await repository.execute(execution.id);
   expect((await database.client`select status from account_erasures where id=${execution.id}`)[0]?.status).toBe('COMPLETED');
  }finally{release();await Promise.allSettled([sender,confirmation]);}
 });

});
