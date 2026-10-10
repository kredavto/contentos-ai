import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { AdminRepository, PrivacyRepository } from '../../packages/db/src/index';
import { PrivacyService } from '../../packages/core/src/privacy';
import { hashPassword } from '../../packages/core/src/password';
import { AdminService } from '../../packages/core/src/admin';
import { isolatedTestDatabase } from '../helpers/isolated-database';
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('private account deletion intake', () => {
  const database = isolatedTestDatabase(url), repository = new PrivacyRepository(database.db), service = new PrivacyService(repository);
  const user = randomUUID(), other = randomUUID(), unverified = randomUUID(), tenant = randomUUID(), correlation = randomUUID();
  const password = 'Fixture privacy password 123!', key = randomUUID();
  let proof = '', requestId = '', revision = '';
  beforeAll(async () => {
    proof = await hashPassword(password);
    for (const id of [user, other, unverified]) await database.client`insert into users(id,email,name,password_hash,email_verified_at) values(${id},${`${id}@example.test`},'Privacy fixture',${proof},${id === unverified ? null : new Date().toISOString()})`;
    await database.client`insert into organizations(id,name) values(${tenant},'Owned organization')`;
    await database.client`insert into organization_members(tenant_id,user_id,role) values(${tenant},${user},'OWNER')`;
    await database.client`insert into sessions(user_id,token_hash,expires_at) values(${user},'active-session-sentinel',now()+interval '1 hour'),(${user},'expired-session-sentinel',now()-interval '1 hour'),(${other},'other-session-sentinel',now()+interval '1 hour')`;
  });
  it('returns only the current account and exposes ownership obligations without secrets', async () => {
    const overview = await service.overview(user);
    expect(overview.user.id).toBe(user); expect(overview.activeSessions).toBe(1); expect(overview.ownedOrganizations.map(row => row.id)).toEqual([tenant]);
    expect(JSON.stringify(overview)).not.toMatch(/sentinel|scrypt|passwordHash|requestKey/);
    expect((await service.overview(other)).ownedOrganizations).toEqual([]);
    expect((await service.overview(unverified)).user.verifiedAt).toBeNull();
  });
  it('requires a current password, verified account and explicit acknowledgement', async () => {
    const input = { password, acknowledged: true, idempotencyKey: key };
    await expect(service.request(user, { ...input, password: 'wrong-password' }, correlation)).rejects.toThrow('NOT_AUTHORIZED');
    await expect(service.request(unverified, input, correlation)).rejects.toThrow('NOT_AUTHORIZED');
    await expect(service.request(user, { ...input, acknowledged: false }, correlation)).rejects.toThrow();
    expect(await database.client`select id from account_deletion_requests`).toHaveLength(0);
  });
  it('serializes duplicate submissions and records one pending request without erasing data', async () => {
    const input = { password, acknowledged: true, idempotencyKey: key };
    const result = await Promise.all([service.request(user, input, correlation), service.request(user, input, correlation)]);
    expect(result[0]).toEqual(result[1]); requestId = result[0]!.id; revision = result[0]!.revision;
    expect(result[0]!.status).toBe('REQUESTED');
    await expect(service.request(user, { ...input, idempotencyKey: randomUUID() }, correlation)).rejects.toThrow('CONFLICT');
    expect(await database.client`select id from sessions where user_id=${user}`).toHaveLength(2);
    expect(await database.client`select id from users where id=${user} and disabled_at is null`).toHaveLength(1);
    expect(await database.client`select id from organizations where id=${tenant}`).toHaveLength(1);
    const audit = await database.client`select metadata from audit_logs where action='ACCOUNT_DELETION_REQUESTED' and user_id=${user}`;
    expect(audit).toHaveLength(1); expect(audit[0]!.metadata).toEqual({});
    await expect(database.client`update account_deletion_requests set status='CANCELLED',cancelled_at=null,revision=${randomUUID()} where id=${requestId}`).rejects.toThrow();
  });
  it('fences stale password proof and revoked accounts before persisting a request', async () => {
    await database.client`update users set password_hash='changed-proof' where id=${other}`;
    await expect(repository.request(other, proof, randomUUID(), correlation)).rejects.toThrow('NOT_AUTHORIZED');
    await database.client`update users set password_hash=${proof},disabled_at=now() where id=${other}`;
    await expect(repository.request(other, proof, randomUUID(), correlation)).rejects.toThrow('NOT_AUTHORIZED');
    await expect(service.overview(other)).rejects.toThrow('NOT_AUTHORIZED');
    await database.client`update users set disabled_at=null where id=${other}`;
  });
  it('cancels only owned requests, rejects stale revisions and never resurrects a replay', async () => {
    await expect(service.cancel(other, { requestId, revision }, correlation)).rejects.toThrow('NOT_FOUND');
    await expect(service.cancel(user, { requestId, revision: randomUUID() }, correlation)).rejects.toThrow('CONFLICT');
    const cancelled = await service.cancel(user, { requestId, revision }, correlation);
    expect(cancelled.status).toBe('CANCELLED'); expect(cancelled.revision).not.toBe(revision);
    expect(await service.cancel(user, { requestId, revision }, correlation)).toEqual(cancelled);
    expect((await service.request(user, { password, acknowledged: true, idempotencyKey: key }, correlation)).status).toBe('CANCELLED');
    await expect(database.client`update account_deletion_requests set status='REQUESTED',cancelled_at=null where id=${requestId}`).rejects.toThrow();
    const fresh = await service.request(user, { password, acknowledged: true, idempotencyKey: randomUUID() }, correlation);
    expect(fresh.id).not.toBe(requestId);
    expect((await service.overview(user)).requests).toHaveLength(2);
    expect((await service.overview(other)).requests).toEqual([]);
    expect(await database.client`select id from audit_logs where action='ACCOUNT_DELETION_CANCELLED' and resource_id=${requestId}`).toHaveLength(1);
  });
  it('exports only own allowlisted data and audits without archive contents', async () => {
    await expect(service.exportAccount(user, { password: 'wrong' }, correlation)).rejects.toThrow('NOT_AUTHORIZED');
    await expect(service.exportAccount(unverified, { password }, correlation)).rejects.toThrow('NOT_AUTHORIZED');
    await expect(repository.exportAccount(user, 'stale-proof', correlation)).rejects.toThrow('NOT_AUTHORIZED');
    const archive = await service.exportAccount(user, { password }, correlation);
    expect(archive.profile.id).toBe(user); expect(archive.memberships).toHaveLength(1);
    expect(archive.memberships[0]?.organizationId).toBe(tenant);
    expect(archive.sessionHistory).toHaveLength(2); expect(archive.deletionRequests).toHaveLength(2);
    expect(JSON.stringify(archive)).not.toMatch(/sentinel|scrypt|passwordHash|requestKey|tokenHash/);
    expect(JSON.stringify(archive)).not.toContain(other);
    expect(Object.keys(archive.profile)).toEqual(['id', 'name', 'email', 'emailVerifiedAt', 'createdAt']);
    const audit = await database.client`select metadata from audit_logs where user_id=${user} and action='ACCOUNT_DATA_EXPORTED'`;
    expect(audit).toHaveLength(1); expect(audit[0]!.metadata).toEqual({});
  });
  it('fails oversized exports without returning partial data or recording success', async () => {
    await database.client`insert into sessions(user_id,token_hash,expires_at) select ${other},'export-limit-'||i::text,now()+interval '1 hour' from generate_series(1,10001) i`;
    await expect(service.exportAccount(other, { password }, correlation)).rejects.toThrow('EXPORT_TOO_LARGE');
    expect(await database.client`select id from audit_logs where user_id=${other} and action='ACCOUNT_DATA_EXPORTED'`).toHaveLength(0);
  });
  it('makes request metadata visible to provisioned operators, never ordinary owners', async () => {
    const admin = new AdminService(new AdminRepository(database.db), true, []);
    await expect(admin.list(user, { category: 'deletion_requests' }, correlation)).rejects.toThrow('NOT_AUTHORIZED');
    await database.client`insert into platform_operators(user_id,role) values(${other},'SUPPORT')`;
    const list = await admin.list(other, { category: 'deletion_requests' }, correlation);
    expect(list.rows).toHaveLength(2);
    expect(Object.keys(list.rows[0]!)).toEqual(['id', 'userId', 'status', 'cancelledAt', 'createdAt']);
    expect(JSON.stringify(list)).not.toContain(password);
    expect(() => admin.list(other, { category: 'deletion_requests', tenantId: tenant }, correlation)).toThrow();
  });
});
