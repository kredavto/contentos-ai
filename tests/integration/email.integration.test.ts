import { randomUUID, randomBytes } from 'node:crypto';
import { describe,it,expect } from 'vitest';
import { AuthRepository,EmailRepository } from '../../packages/db/src/index';
import { AuthService } from '../../packages/core/src/auth';
import { EmailProcessor } from '../../packages/core/src/email';
import { CredentialVault } from '../../packages/core/src/credential-vault';
import { DomainError,type EmailProvider } from '../../packages/types/src/index';
import { isolatedTestDatabase } from '../helpers/isolated-database';
const url=process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('durable encrypted authentication mail',()=>{
  const database=isolatedTestDatabase(url),repository=new EmailRepository(database.db),authRepo=new AuthRepository(database.db);
  const vault=new CredentialVault(JSON.stringify({test:randomBytes(32).toString('base64')}),'test');
  const auth=new AuthService(authRepo,vault,'http://localhost:3000','Test');
  const delivered:Array<{text:string;key:string}>=[];
  const provider:EmailProvider={send:async(input,ctx)=>{delivered.push({text:input.text,key:ctx.idempotencyKey});return {provider:'fixture',externalId:ctx.idempotencyKey,internalId:ctx.internalId,metadata:{}};}};
  const processor=new EmailProcessor(repository,provider,vault);
  async function fixture(){const id=randomUUID(),email=`mail-${id}@example.test`;await auth.register({email,name:'Mail fixture',password:'correct-test-password'},id,id);const user=(await authRepo.findUser(email))!;const [mail]=await database.client`select * from email_outbox where user_id=${user.id}`;return {id:mail!.id as string,userId:user.id,email,correlation:id};}
  it('commits token and encrypted mail atomically, sends once under concurrent claims and clears secrets',async()=>{
    const f=await fixture();const [before]=await database.client`select * from email_outbox where id=${f.id}`;
    expect(JSON.stringify(before)).not.toContain(f.email);expect(JSON.stringify(before)).not.toContain('token=');
    const count=delivered.length;await Promise.all([processor.runOnce(f.id),processor.runOnce(f.id)]);expect(delivered.length-count).toBe(1);expect(delivered.at(-1)?.key).toBe(f.id);
    const token=delivered.at(-1)!.text.match(/token=([a-zA-Z0-9_-]+)/)![1];await auth.verify({token},f.correlation,f.correlation);
    const [after]=await database.client`select status,payload from email_outbox where id=${f.id}`;expect(after).toEqual({status:'SENT',payload:null});expect(await processor.runOnce(f.id)).toBe(false);
    await expect(database.client`update email_outbox set status='PENDING',payload=${JSON.stringify(before!.payload)}::jsonb where id=${f.id}`).rejects.toThrow('immutable');
    expect(await database.client`select id from audit_logs where resource_id=${f.id} and action='AUTH_EMAIL_DELIVERED'`).toHaveLength(1);
  });
  it('retries transient delivery with the same message/token and fences an expired lease',async()=>{
    const f=await fixture();let failed=0;
    const failing=new EmailProcessor(repository,{send:async()=>{failed++;throw new DomainError('PROVIDER_UNAVAILABLE');}},vault);
    await failing.runOnce(f.id);expect(failed).toBe(1);expect(await processor.runOnce(f.id)).toBe(false);
    await database.client`update email_outbox set next_attempt_at=now() where id=${f.id}`;
    const old=await repository.claim(f.id);expect(old?.attempt).toBe(2);
    await database.client`update email_outbox set lease_until=now()-interval '1 second' where id=${f.id}`;
    const current=await repository.claim(f.id);expect(current?.attempt).toBe(3);
    expect(await repository.complete(f.id,old!.leaseToken!)).toBe(false);
    await repository.fail(f.id,current!.leaseToken!,'PROVIDER_UNAVAILABLE');
    await database.client`update email_outbox set next_attempt_at=now() where id=${f.id}`;
    await processor.runOnce(f.id);expect(delivered.at(-1)?.key).toBe(f.id);
  });
  it('cancels superseded, expired and disabled-account messages without delivery',async()=>{
    const f=await fixture();await auth.requestToken({email:f.email},'VERIFY_EMAIL',f.correlation,f.correlation);
    await repository.cleanup();expect(await processor.runOnce(f.id)).toBe(false);
    const [replacement]=await database.client`select id from email_outbox where user_id=${f.userId} and status='PENDING'`;
    await database.client`update users set disabled_at=now() where id=${f.userId}`;await repository.cleanup();expect(await processor.runOnce(replacement!.id as string)).toBe(false);
    const expired=await fixture();await database.client`update auth_tokens set expires_at=now()-interval '1 second' where user_id=${expired.userId}`;await repository.cleanup();
    const [row]=await database.client`select status,payload from email_outbox where id=${expired.id}`;expect(row).toEqual({status:'CANCELED',payload:null});
  });
  it('bounds retries and rejects cross-user envelope substitution',async()=>{
    const f=await fixture(),other=await fixture();const [source]=await database.client`select payload from email_outbox where id=${f.id}`;
    await database.client`update email_outbox set payload=${JSON.stringify(source!.payload)}::jsonb,attempt=7 where id=${other.id}`;
    const count=delivered.length;await processor.runOnce(other.id);expect(delivered).toHaveLength(count);
    const [row]=await database.client`select status,payload,error_code from email_outbox where id=${other.id}`;expect(row).toEqual({status:'FAILED',payload:null,error_code:'CONFIGURATION_REQUIRED'});
  });
  it('refuses unconfigured registration before creating an account and rolls back an invalid mail binding',async()=>{
    const email=`unconfigured-${randomUUID()}@example.test`,unconfigured=new AuthService(authRepo,null,'http://localhost:3000','Test');
    await expect(unconfigured.register({email,name:'Fixture',password:'correct-test-password'},randomUUID(),randomUUID())).rejects.toThrow('CONFIGURATION_REQUIRED');expect(await authRepo.findUser(email)).toBeUndefined();
    const existing=await fixture();const id=randomUUID(),mail={id:existing.id,payload:vault.encrypt('fixture',{kind:'AUTH_EMAIL',userId:id,messageId:existing.id})};
    await expect(authRepo.register({id,email,name:'Fixture',passwordHash:'unusable',tokenHash:randomUUID(),correlationId:randomUUID(),mail})).rejects.toThrow();expect(await authRepo.findUser(email)).toBeUndefined();
  });
});
