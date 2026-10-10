import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { PrivacyRepository } from '../../packages/db/src/index';
import { PrivacyService } from '../../packages/core/src/privacy';
import { hashPassword } from '../../packages/core/src/password';
import { isolatedTestDatabase } from '../helpers/isolated-database';
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('personal evidence export', () => {
  const database = isolatedTestDatabase(url), repository = new PrivacyRepository(database.db), service = new PrivacyService(repository);
  const user = randomUUID(), other = randomUUID(), tenant = randomUUID(), workspace = randomUUID(), brand = randomUUID(), subject = randomUUID();
  const ownConsent = randomUUID(), revokedConsent = randomUUID(), foreignConsent = randomUUID(), ownRenewal = randomUUID();
  const password = 'Export evidence fixture 123!';
  let proof = '';
  beforeAll(async () => {
    proof = await hashPassword(password);
    for (const id of [user, other]) {
      await database.client`insert into users(id,email,name,password_hash,email_verified_at) values(${id},${`${id}@example.test`},'Export fixture',${proof},now())`;
      await database.client`insert into auth_tokens(user_id,token_hash,type,expires_at) values(${id},${`secret-token-${id}`},'RESET_PASSWORD',now()+interval '1 hour')`;
      await database.client`insert into email_outbox(id,user_id,token_hash,payload,correlation_id) values(${randomUUID()},${id},${`secret-token-${id}`},'{"ciphertext":"secret-envelope"}',${randomUUID()})`;
      await database.client`insert into audit_logs(user_id,action,correlation_id,metadata) values(${id},${id === user ? 'OWN_ACTION' : 'FOREIGN_ACTION'},${randomUUID()},'{"private":"secret-audit"}')`;
    }
    await database.client`insert into organizations(id,name) values(${tenant},'Secret organization name')`;
    await database.client`insert into workspaces(id,tenant_id,name) values(${workspace},${tenant},'Private workspace')`;
    await database.client`insert into brands(id,tenant_id,workspace_id,name) values(${brand},${tenant},${workspace},'Private brand')`;
    await database.client`insert into consent_subjects(id,tenant_id,brand_id,name,type) values(${subject},${tenant},${brand},'Secret third-party identity','PERSON')`;
    for (const [id, acceptor, revoker] of [[ownConsent,user,other],[revokedConsent,other,user],[foreignConsent,other,null]] as const) {
      await database.client`insert into consent_records(id,tenant_id,subject_id,subject_type,subject_name,consent_type,consent_version,consent_text_hash,accepted_by_user_id,ip_address,user_agent,revoked_at,revoked_by_user_id,idempotency_key) values(${id},${tenant},${subject},'PERSON','Secret third-party identity','THIRD_PARTY_LIKENESS','v1',${'a'.repeat(64)},${acceptor},${acceptor === user ? '192.0.2.1' : '198.51.100.1'},${acceptor === user ? 'Own browser' : 'Secret foreign browser'},case when ${revoker}::uuid is not null then now() else null end,${revoker},${randomUUID()})`;
    }
    const [plan] = await database.client`select id from plans where code='START'`;
    const version = randomUUID();
    await database.client`insert into plan_versions(id,plan_id,version,amount_minor,ai_credits,video_seconds) values(${version},${plan!.id},999,100,10,10)`;
    for (const id of [user,other]) await database.client`insert into billing_renewal_consents(id,tenant_id,plan_version_id,policy_version,policy_text,text_hash,amount_minor,currency,accepted_by,ip_address,user_agent) values(${id === user ? ownRenewal : randomUUID()},${tenant},${version},'v1',${id === user ? 'Agreed monthly terms' : 'Secret foreign terms'},${'b'.repeat(64)},100,'RUB',${id},'192.0.2.2','Fixture browser')`;
  });
  it('exports retained own evidence without requiring former tenant access or disclosing third parties', async () => {
    const archive = await service.exportAccount(user, { password }, randomUUID());
    expect(archive.version).toBe(2); expect(archive.memberships).toEqual([]);
    expect(archive.authenticationHistory).toHaveLength(1); expect(archive.authenticationHistory[0]?.type).toBe('RESET_PASSWORD');
    expect(archive.emailHistory).toHaveLength(1); expect(archive.emailHistory[0]?.status).toBe('PENDING');
    expect(archive.acceptedConsents.map(row => row.id)).toEqual([ownConsent]);
    expect(archive.acceptedConsents[0]?.ipAddress).toBe('192.0.2.1');
    expect(archive.consentRevocations.map(row => row.id)).toEqual([revokedConsent]);
    expect(Object.keys(archive.consentRevocations[0]!)).toEqual(['id','type','revokedAt']);
    expect(archive.renewalConsentHistory.map(row => row.id)).toEqual([ownRenewal]);
    expect(archive.renewalConsentHistory[0]?.policyText).toBe('Agreed monthly terms');
    expect(archive.activityHistory).toEqual([{ action: 'OWN_ACTION', createdAt: expect.any(Date) }]);
    const serialized = JSON.stringify(archive);
    expect(serialized).not.toMatch(/secret|Secret|FOREIGN_ACTION|198\.51\.100\.1|passwordHash|tokenHash|ciphertext|idempotencyKey/);
    for (const id of [other,tenant,brand,subject,foreignConsent]) expect(serialized).not.toContain(id);
  });
  it('rejects disabled accounts and stale proof before reading evidence', async () => {
    await expect(repository.exportAccount(user, 'outdated', randomUUID())).rejects.toThrow('NOT_AUTHORIZED');
    await database.client`update users set disabled_at=now() where id=${user}`;
    await expect(repository.exportAccount(user, proof, randomUUID())).rejects.toThrow('NOT_AUTHORIZED');
    await database.client`update users set disabled_at=null where id=${user}`;
  });
  it('rejects oversized evidence instead of truncating activity history', async () => {
    await database.client`insert into audit_logs(user_id,action,correlation_id) select ${user},'LIMIT_FIXTURE',${randomUUID()} from generate_series(1,10001)`;
    await expect(service.exportAccount(user, { password }, randomUUID())).rejects.toThrow('EXPORT_TOO_LARGE');
    expect(await database.client`select id from audit_logs where user_id=${user} and action='ACCOUNT_DATA_EXPORTED'`).toHaveLength(1);
  });
});
