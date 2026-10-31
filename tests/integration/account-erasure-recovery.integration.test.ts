import {randomUUID} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import {AccountErasureRepository,AccountErasureRecoveryRepository} from '../../packages/db/src/index';
import {AdminPrivacyRepository} from '../../packages/db/src/repositories/admin-privacy';
import {isolatedTestDatabase} from '../helpers/isolated-database';
const url=process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('operator recovery of original account erasure consent',()=>{
 const database=isolatedTestDatabase(url),erasure=new AccountErasureRepository(database.db),recovery=new AccountErasureRecoveryRepository(database.db),inspection=new AdminPrivacyRepository(database.db);
 async function user(){const id=randomUUID();await database.client`insert into users(id,email,name,password_hash,email_verified_at) values(${id},${id+'@example.test'},'Recovery fixture','unusable-test-proof',now())`;return id;}
 async function fixture(){const subject=await user(),actor=await user(),support=await user(),request=randomUUID();
  await database.client`insert into platform_operators(user_id,role) values(${actor},'ADMIN'),(${support},'SUPPORT')`;
  await database.client`insert into account_deletion_requests(id,user_id,request_key) values(${request},${subject},${randomUUID()})`;
  const [intake]=await database.client`select revision from account_deletion_requests where id=${request}`;
  const execution=await erasure.request(subject,'unusable-test-proof',{requestId:request,revision:String(intake!.revision),idempotencyKey:randomUUID()},randomUUID());
  await erasure.fail(execution.id);await erasure.fail(execution.id);await erasure.fail(execution.id);
  const input={expectedRecoveryId:null,idempotencyKey:randomUUID(),reason:'TRANSIENT_FAILURE_RESOLVED' as const,ticket:'RECOVERY-123',acknowledgeOriginalScope:true as const};
  return {subject,actor,support,request,id:execution.id,input,retry:()=>recovery.retry(actor,execution.id,input,randomUUID())};
 }
 it('requires an active verified ADMIN and never converts old request intake into execution',async()=>{
  const f=await fixture();for(const actor of [f.support,f.subject])await expect(recovery.retry(actor,f.id,f.input,randomUUID())).rejects.toThrow('NOT_AUTHORIZED');
  expect((await inspection.inspect(f.support,f.request,randomUUID())).recoveryAvailable).toBe(false);expect((await inspection.inspect(f.actor,f.request,randomUUID())).recoveryAvailable).toBe(true);
  await expect(recovery.retry(f.actor,f.request,f.input,randomUUID())).rejects.toThrow('NOT_FOUND');
  await database.client`update platform_operators set revoked_at=now() where user_id=${f.actor}`;await expect(f.retry()).rejects.toThrow('NOT_AUTHORIZED');
  expect(await database.client`select id from account_erasure_recoveries where erasure_id=${f.id}`).toHaveLength(0);
 });
 it('rechecks late resources before requeue and completes only the original profile scope',async()=>{
  const f=await fixture();await database.client`create table recovery_late_resource(user_id uuid references users(id), payload text)`;
  try{await database.client`insert into recovery_late_resource values(${f.subject},'Must remain')`;await expect(f.retry()).rejects.toThrow('CONFLICT');expect(await database.client`select id from account_erasure_recoveries where erasure_id=${f.id}`).toHaveLength(0);
   await database.client`delete from recovery_late_resource where user_id=${f.subject}`;const result=await f.retry();expect(result.status).toBe('QUEUED');await erasure.execute(f.id);
   expect((await database.client`select email,erased_at from users where id=${f.subject}`)[0]).toMatchObject({email:`deleted+${f.subject}@account.invalid`,erased_at:expect.stringMatching(/^\d{4}-\d{2}-\d{2}/)});
   expect((await f.retry()).status).toBe('COMPLETED');await expect(recovery.retry(f.actor,f.id,{...f.input,idempotencyKey:randomUUID(),expectedRecoveryId:result.recoveryId},randomUUID())).rejects.toThrow('CONFLICT');
  }finally{await database.client`drop table recovery_late_resource`;}
 });
 it('deduplicates concurrent operator requests and records immutable retry snapshots',async()=>{
  const f=await fixture(),[first,second]=await Promise.all([f.retry(),f.retry()]);expect(first).toEqual(second);
  const [history]=await database.client`select previous_attempt,previous_error_code,previous_recovery_id from account_erasure_recoveries where erasure_id=${f.id}`;expect(history).toEqual({previous_attempt:3,previous_error_code:'ERASURE_FAILED',previous_recovery_id:null});
  expect(await database.client`select id from audit_logs where resource_id=${f.id} and action='ADMIN_ACCOUNT_ERASURE_RECOVERED'`).toHaveLength(1);
  await expect(recovery.retry(f.actor,f.id,{...f.input,ticket:'CHANGED'},randomUUID())).rejects.toThrow('CONFLICT');
  await expect(database.client`update account_erasure_recoveries set ticket='CHANGED' where id=${first!.recoveryId}`).rejects.toThrow();await expect(database.client`delete from account_erasure_recoveries where id=${first!.recoveryId}`).rejects.toThrow();
  await expect(database.client`update account_erasures set recovery_id=null where id=${f.id}`).rejects.toThrow();
  const view=await inspection.inspect(f.actor,f.request,randomUUID());expect(view.recoveries).toHaveLength(1);expect(view.recoveryAvailable).toBe(false);
 });
 it('requires a fresh revision for each blocked cycle and old idempotency replay never requeues',async()=>{
  const f=await fixture(),first=await f.retry();await erasure.fail(f.id);await erasure.fail(f.id);await erasure.fail(f.id);
  expect((await f.retry()).status).toBe('BLOCKED');await expect(recovery.retry(f.actor,f.id,{...f.input,idempotencyKey:randomUUID()},randomUUID())).rejects.toThrow('CONFLICT');
  const next=await recovery.retry(f.actor,f.id,{...f.input,idempotencyKey:randomUUID(),expectedRecoveryId:first.recoveryId},randomUUID());await erasure.fail(f.id);await erasure.fail(f.id);await erasure.fail(f.id);
  await expect(database.client`update account_erasures set status='QUEUED',attempt=0,error_code=null,recovery_id=${first.recoveryId} where id=${f.id}`).rejects.toThrow();
  expect((await database.client`select previous_recovery_id from account_erasure_recoveries where id=${next.recoveryId}`)[0]?.previous_recovery_id).toBe(first.recoveryId);
  const other=await fixture();await expect(database.client`update account_erasures set status='QUEUED',attempt=0,error_code=null,recovery_id=${next.recoveryId} where id=${other.id}`).rejects.toThrow();
 });
 it('accepts only one of two new intents for the same blocked revision',async()=>{
  const f=await fixture(),results=await Promise.allSettled([f.retry(),recovery.retry(f.actor,f.id,{...f.input,idempotencyKey:randomUUID()},randomUUID())]);
  expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);expect(results.filter(result=>result.status==='rejected')).toHaveLength(1);
  expect(await database.client`select id from account_erasure_recoveries where erasure_id=${f.id}`).toHaveLength(1);
 });
 it('preserves uncertain mail evidence rather than requeueing erasure',async()=>{
  const f=await fixture(),token=randomUUID();await database.client`insert into auth_tokens(user_id,token_hash,type,expires_at,consumed_at) values(${f.subject},${token},'RESET_PASSWORD',now()+interval '1 hour',now())`;
  await database.client`insert into email_outbox(id,user_id,token_hash,payload,correlation_id,status,submitted_at) values(${randomUUID()},${f.subject},${token},null,${randomUUID()},'RECONCILIATION',now())`;
  await expect(f.retry()).rejects.toThrow('CONFLICT');expect(await database.client`select id from email_outbox where user_id=${f.subject}`).toHaveLength(1);
 });
});
