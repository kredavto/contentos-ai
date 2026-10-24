import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { TeamRepository } from '../../packages/db/src/index';
import { TeamService } from '../../packages/core/src/team';
import { hashToken } from '../../packages/core/src/password';
import { CredentialVault } from '../../packages/core/src/credential-vault';
import { isolatedTestDatabase } from '../helpers/isolated-database';
const url=process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('team access and invitations',()=>{
  const database=isolatedTestDatabase(url),repository=new TeamRepository(database.db),vault=new CredentialVault(JSON.stringify({v1:randomBytes(32).toString('base64')}),'v1'),service=new TeamService(repository,vault,'https://contentos.example.test');
  async function user(){const id=randomUUID(),email=`team-${id}@example.test`;await database.client`insert into users(id,email,password_hash,name,email_verified_at) values(${id},${email},'unusable','Fixture',now())`;return {id,email};}
  async function fixture(){const tenantId=randomUUID(),owner=await user(),admin=await user(),editor=await user(),guest=await user();await database.client`insert into organizations(id,name) values(${tenantId},'Team fixture')`;
    for(const [id,role] of [[owner.id,'OWNER'],[admin.id,'ADMIN'],[editor.id,'EDITOR']])await database.client`insert into organization_members(tenant_id,user_id,role) values(${tenantId},${id!},${role!})`;
    return {tenantId,owner,admin,editor,guest};
  }
  const invite=(f:Awaited<ReturnType<typeof fixture>>,role='VIEWER')=>service.invite(f.owner.id,f.tenantId,{email:f.guest.email,role,idempotencyKey:randomUUID()},randomUUID());
  const token=(link:string)=>new URL(link).hash.slice(1);
  async function revision(tenantId:string,id:string){const [m]=await database.client`select revision from organization_members where tenant_id=${tenantId} and user_id=${id}`;return String(m!.revision);}
  it('replays one encrypted invite and accepts only its verified email, once',async()=>{
    const f=await fixture(),input={email:f.guest.email.toUpperCase(),role:'EDITOR',idempotencyKey:randomUUID()};
    const [a,b]=await Promise.all([service.invite(f.owner.id,f.tenantId,input,randomUUID()),service.invite(f.owner.id,f.tenantId,input,randomUUID())]);expect(a.link).toBe(b.link);
    const [row]=await database.client`select * from team_invitations where id=${a.id}`;expect(JSON.stringify(row)).not.toContain(token(a.link));
    await expect(service.accept(f.editor.id,{token:token(a.link)},randomUUID())).rejects.toThrow('NOT_FOUND');
    await database.client`update users set email_verified_at=null where id=${f.guest.id}`;await expect(service.accept(f.guest.id,{token:token(a.link)},randomUUID())).rejects.toThrow('NOT_FOUND');
    await database.client`update users set email_verified_at=now() where id=${f.guest.id}`;
    const results=await Promise.all([service.accept(f.guest.id,{token:token(a.link)},randomUUID()),service.accept(f.guest.id,{token:token(a.link)},randomUUID())]);expect(results).toEqual([{tenantId:f.tenantId},{tenantId:f.tenantId}]);
    const [done]=await database.client`select encrypted_token from team_invitations where id=${a.id}`;expect(done!.encrypted_token).toBeNull();
    await expect(database.client`update team_invitations set email='other@example.test' where id=${a.id}`).rejects.toThrow('identity');
  });
  it('denies elevation, foreign tenants and modifying owners',async()=>{
    const f=await fixture(),other=await fixture();
    await expect(service.overview(f.editor.id,f.tenantId)).rejects.toThrow('NOT_AUTHORIZED');await expect(service.overview(f.owner.id,other.tenantId)).rejects.toThrow('NOT_FOUND');
    await expect(service.invite(f.admin.id,f.tenantId,{email:f.guest.email,role:'ADMIN',idempotencyKey:randomUUID()},randomUUID())).rejects.toThrow('NOT_AUTHORIZED');
    await expect(service.remove(f.owner.id,f.tenantId,{userId:f.owner.id,revision:await revision(f.tenantId,f.owner.id)},randomUUID())).rejects.toThrow('NOT_AUTHORIZED');
    await expect(service.changeRole(f.admin.id,f.tenantId,{userId:f.editor.id,revision:await revision(f.tenantId,f.editor.id),role:'ADMIN'},randomUUID())).rejects.toThrow('NOT_AUTHORIZED');
  });
  it('invalidates revoked invitations and rechecks issuer permissions at acceptance',async()=>{
    const f=await fixture(),a=await invite(f,'ADMIN');
    await service.changeRole(f.owner.id,f.tenantId,{userId:f.admin.id,revision:await revision(f.tenantId,f.admin.id),role:'VIEWER'},randomUUID());
    const b=await service.invite(f.owner.id,f.tenantId,{email:f.guest.email,role:'VIEWER',idempotencyKey:randomUUID()},randomUUID());
    await service.revoke(f.owner.id,f.tenantId,{id:b.id},randomUUID());await expect(service.accept(f.guest.id,{token:token(b.link)},randomUUID())).rejects.toThrow('NOT_FOUND');
    await service.transfer(f.owner.id,f.tenantId,{userId:f.editor.id,revision:await revision(f.tenantId,f.editor.id),ownerRevision:await revision(f.tenantId,f.owner.id)},randomUUID());
    await expect(service.accept(f.guest.id,{token:token(a.link)},randomUUID())).rejects.toThrow('NOT_FOUND');
    const state=await service.overview(f.editor.id,f.tenantId);expect(state.members.filter(m=>m.role==='OWNER').map(m=>m.userId)).toEqual([f.editor.id]);
  });
  it('rejects stale concurrent updates and stale revisions after removal/rejoin',async()=>{
    const f=await fixture(),rev=await revision(f.tenantId,f.editor.id),input={userId:f.editor.id,revision:rev};
    const result=await Promise.allSettled([service.changeRole(f.owner.id,f.tenantId,{...input,role:'MANAGER'},randomUUID()),service.changeRole(f.owner.id,f.tenantId,{...input,role:'VIEWER'},randomUUID())]);expect(result.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    const current=await revision(f.tenantId,f.editor.id);await service.remove(f.owner.id,f.tenantId,{userId:f.editor.id,revision:current},randomUUID());
    const invitation=await service.invite(f.owner.id,f.tenantId,{email:f.editor.email,role:'EDITOR',idempotencyKey:randomUUID()},randomUUID());await service.accept(f.editor.id,{token:token(invitation.link)},randomUUID());
    await expect(service.remove(f.owner.id,f.tenantId,{userId:f.editor.id,revision:current},randomUUID())).rejects.toThrow('CONFLICT');
  });
  it('cannot use an old accepted link to restore removed membership or overwrite roles',async()=>{
    const f=await fixture(),a=await invite(f);await service.accept(f.guest.id,{token:token(a.link)},randomUUID());
    await service.changeRole(f.owner.id,f.tenantId,{userId:f.guest.id,revision:await revision(f.tenantId,f.guest.id),role:'EDITOR'},randomUUID());await service.accept(f.guest.id,{token:token(a.link)},randomUUID());
    expect((await service.overview(f.owner.id,f.tenantId)).members.find(m=>m.userId===f.guest.id)?.role).toBe('EDITOR');
    await service.remove(f.owner.id,f.tenantId,{userId:f.guest.id,revision:await revision(f.tenantId,f.guest.id)},randomUUID());await expect(service.accept(f.guest.id,{token:token(a.link)},randomUUID())).rejects.toThrow('NOT_FOUND');
  });
  it('keeps idempotency bound to exact intent and requires the vault before writes',async()=>{
    const f=await fixture(),input={email:f.guest.email,role:'VIEWER',idempotencyKey:randomUUID()};await service.invite(f.owner.id,f.tenantId,input,randomUUID());
    await expect(service.invite(f.owner.id,f.tenantId,{...input,role:'EDITOR'},randomUUID())).rejects.toThrow('CONFLICT');
    await expect(new TeamService(repository,null,'https://contentos.example.test').invite(f.owner.id,f.tenantId,{...input,idempotencyKey:randomUUID()},randomUUID())).rejects.toThrow('CONFIGURATION_REQUIRED');
    const [count]=await database.client`select count(*)::int as n from team_invitations where tenant_id=${f.tenantId}`;expect(count!.n).toBe(1);
  });
  it('rejects expired links and binds encrypted tokens to tenant and invitation identity',async()=>{
    const f=await fixture(),id=randomUUID(),secret=randomBytes(32).toString('base64url'),scope={kind:'TEAM_INVITATION' as const,tenantId:f.tenantId,invitationId:id},encrypted=vault.encrypt(secret,scope);
    for(const changed of [{tenantId:randomUUID()},{invitationId:randomUUID()}])expect(()=>vault.decrypt(encrypted,{...scope,...changed})).toThrow('CONFIGURATION_REQUIRED');
    await database.client`insert into team_invitations(id,tenant_id,created_by,email,role,request_key,token_hash,encrypted_token,created_at,expires_at) values(${id},${f.tenantId},${f.owner.id},${f.guest.email},'VIEWER',${randomUUID()},${hashToken(secret)},${JSON.stringify(encrypted)}::jsonb,now()-interval '8 days',now()-interval '1 day')`;
    await expect(service.accept(f.guest.id,{token:secret},randomUUID())).rejects.toThrow('NOT_FOUND');
    await service.revoke(f.owner.id,f.tenantId,{id},randomUUID());
    await expect(database.client`update team_invitations set revoked_at=null,encrypted_token=${JSON.stringify(encrypted)}::jsonb where id=${id}`).rejects.toThrow('Terminal');
  });
  it('rejects unverified managers and disabled ownership recipients',async()=>{
    const f=await fixture();await database.client`update users set email_verified_at=null where id=${f.admin.id}`;
    await expect(service.overview(f.admin.id,f.tenantId)).rejects.toThrow('NOT_AUTHORIZED');
    await database.client`update users set disabled_at=now() where id=${f.editor.id}`;
    await expect(service.transfer(f.owner.id,f.tenantId,{userId:f.editor.id,revision:await revision(f.tenantId,f.editor.id),ownerRevision:await revision(f.tenantId,f.owner.id)},randomUUID())).rejects.toThrow('NOT_AUTHORIZED');
    expect((await service.overview(f.owner.id,f.tenantId)).members.find(m=>m.userId===f.owner.id)?.role).toBe('OWNER');
  });

  it('permanently revokes outstanding invitations when the issuer loses team authority',async()=>{
    const f=await fixture(),a=await service.invite(f.admin.id,f.tenantId,{email:f.guest.email,role:'VIEWER',idempotencyKey:randomUUID()},randomUUID());
    await service.remove(f.owner.id,f.tenantId,{userId:f.admin.id,revision:await revision(f.tenantId,f.admin.id)},randomUUID());
    const rejoin=await service.invite(f.owner.id,f.tenantId,{email:f.admin.email,role:'ADMIN',idempotencyKey:randomUUID()},randomUUID());await service.accept(f.admin.id,{token:token(rejoin.link)},randomUUID());
    await expect(service.accept(f.guest.id,{token:token(a.link)},randomUUID())).rejects.toThrow('NOT_FOUND');
    const [old]=await database.client`select revoked_at,encrypted_token from team_invitations where id=${a.id}`;expect(old!.revoked_at).not.toBeNull();expect(old!.encrypted_token).toBeNull();
  });
  it('serializes competing transfers and preserves exactly one owner',async()=>{
    const f=await fixture(),ownerRevision=await revision(f.tenantId,f.owner.id);
    const results=await Promise.allSettled([f.admin,f.editor].map(async target=>service.transfer(f.owner.id,f.tenantId,{userId:target.id,revision:await revision(f.tenantId,target.id),ownerRevision},randomUUID())));
    expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
    const owners=await database.client`select user_id from organization_members where tenant_id=${f.tenantId} and role='OWNER'`;expect(owners).toHaveLength(1);expect(owners[0]!.user_id).not.toBe(f.owner.id);
  });

});
