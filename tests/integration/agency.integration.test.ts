import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { AgencyRepository, BrandRepository, createDatabase } from '../../packages/db/src/index';
import { AgencyService } from '../../packages/core/src/agency';
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('isolated agency portfolio', () => {
  if (url && !new URL(url).pathname.endsWith('_test')) throw new Error('Dedicated test database required');
  const database = createDatabase(url ?? 'postgresql://localhost/unused_test');
  const repository = new AgencyRepository(database.db), service = new AgencyService(repository, true), brands = new BrandRepository(database.db);
  const owner = randomUUID(), admin = randomUUID(), outsider = randomUUID(), tenant = randomUUID(), existingTenant = randomUUID(), correlation = randomUUID();
  const created: string[] = [];
  let client: { id: string; organizationId: string; revision: string; archivedAt: Date | null };
  const intent = { kind: 'CREATE', name: 'Isolated client', timezone: 'Europe/Moscow', idempotencyKey: randomUUID() };
  beforeAll(async () => {
    for (const id of [owner, admin, outsider]) await database.client`insert into users(id,email,name,password_hash,email_verified_at) values(${id},${`${id}@example.test`},'Agency test','unusable',now())`;
    for (const id of [tenant, existingTenant]) await database.client`insert into organizations(id,name) values(${id},'Portfolio test')`;
    await database.client`insert into organization_members(tenant_id,user_id,role) values(${tenant},${owner},'OWNER'),(${tenant},${admin},'ADMIN'),(${existingTenant},${owner},'OWNER')`;
  });
  afterAll(async () => {
    await database.client`delete from organizations where id=${tenant}`;
    for (const id of [...created, existingTenant]) await database.client`delete from organizations where id=${id}`;
    for (const id of [owner, admin, outsider]) await database.client`delete from users where id=${id}`;
    await database.close();
  });
  it('requires deployment flag and explicit revision-safe owner opt-in', async () => {
    expect(() => new AgencyService(repository, false).overview(owner, tenant)).toThrow('CONFIGURATION_REQUIRED');
    expect((await service.overview(owner, tenant)).enabled).toBe(false);
    await expect(service.addClient(owner, tenant, intent, correlation)).rejects.toThrow('NOT_AUTHORIZED');
    await expect(service.setMode(admin, tenant, { enabled: true, revision: 0 }, correlation)).rejects.toThrow('NOT_AUTHORIZED');
    const outcomes = await Promise.allSettled([1, 2].map(() => service.setMode(owner, tenant, { enabled: true, revision: 0 }, correlation)));
    expect(outcomes.filter(value => value.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(value => value.status === 'rejected')).toHaveLength(1);
    await expect(service.overview(outsider, tenant)).rejects.toThrow('NOT_FOUND');
  });
  it('atomically creates one isolated organization for concurrent retries', async () => {
    const results = await Promise.all([service.addClient(owner, tenant, intent, correlation), service.addClient(owner, tenant, intent, correlation)]);
    client = results[0]!; created.push(client.organizationId); expect(results[1]?.id).toBe(client.id);
    expect((await database.client`select id from workspaces where tenant_id=${client.organizationId}`)).toHaveLength(1);
    expect((await database.client`select user_id,role from organization_members where tenant_id=${client.organizationId}`)).toEqual([{ user_id: owner, role: 'OWNER' }]);
    expect((await database.client`select id from usage_ledger where tenant_id=${client.organizationId}`)).toHaveLength(0);
    expect((await service.overview(owner, tenant)).clients).toHaveLength(1);
    expect((await service.overview(admin, tenant)).clients).toHaveLength(0);
    await expect(brands.overview(admin, client.organizationId)).rejects.toThrow('NOT_FOUND');
    await expect(service.addClient(owner, tenant, { ...intent, name: 'Changed intent' }, correlation)).rejects.toThrow('CONFLICT');
    await expect(service.addClient(admin, tenant, intent, correlation)).rejects.toThrow('CONFLICT');
    await expect(database.client`update agency_clients set client_organization_id=${existingTenant} where id=${client.id}`).rejects.toThrow();
  });
  it('requires ownership to link an existing organization without granting membership', async () => {
    await expect(service.addClient(admin, tenant, { kind: 'LINK', organizationId: existingTenant, idempotencyKey: randomUUID() }, correlation)).rejects.toThrow('NOT_FOUND');
    await expect(service.addClient(owner, tenant, { kind: 'LINK', organizationId: tenant, idempotencyKey: randomUUID() }, correlation)).rejects.toThrow('INVALID_INPUT');
    const linked = await service.addClient(owner, tenant, { kind: 'LINK', organizationId: existingTenant, idempotencyKey: randomUUID() }, correlation);
    expect(linked.organizationId).toBe(existingTenant);
    expect((await service.overview(admin, tenant)).clients).toHaveLength(0);
    await expect(service.addClient(owner, tenant, { kind: 'LINK', organizationId: existingTenant, idempotencyKey: randomUUID() }, correlation)).rejects.toThrow('CONFLICT');
  });
  it('archives only the relationship and requires fresh revision and client ownership to restore', async () => {
    const result = await service.setArchived(owner, tenant, client.id, { archived: true, revision: client.revision }, correlation);
    expect((await brands.overview(owner, client.organizationId)).role).toBe('OWNER');
    expect((await database.client`select id from organizations where id=${client.organizationId}`)).toHaveLength(1);
    const replay = await service.addClient(owner, tenant, intent, correlation); expect(replay.archivedAt).not.toBeNull();
    await expect(service.setArchived(owner, tenant, client.id, { archived: false, revision: client.revision }, correlation)).rejects.toThrow('CONFLICT');
    await database.client`update organization_members set role='VIEWER' where tenant_id=${client.organizationId} and user_id=${owner}`;
    await expect(service.setArchived(owner, tenant, client.id, { archived: false, revision: result!.revision }, correlation)).rejects.toThrow('NOT_AUTHORIZED');
    await database.client`update organization_members set role='OWNER' where tenant_id=${client.organizationId} and user_id=${owner}`;
    await service.setArchived(owner, tenant, client.id, { archived: false, revision: result!.revision }, correlation);
  });
  it('immediately hides clients after membership loss, including idempotent replay', async () => {
    await database.client`delete from organization_members where tenant_id=${client.organizationId} and user_id=${owner}`;
    expect((await service.overview(owner, tenant)).clients.some(value => value.id === client.id)).toBe(false);
    await expect(service.addClient(owner, tenant, intent, correlation)).rejects.toThrow('NOT_FOUND');
    await database.client`insert into organization_members(tenant_id,user_id,role) values(${client.organizationId},${owner},'OWNER')`;
  });
  it('disables portfolio writes without deleting client data and rechecks current verified actor', async () => {
    await service.setMode(owner, tenant, { enabled: false, revision: 1 }, correlation);
    expect((await service.overview(owner, tenant)).clients).toEqual([]);
    await expect(service.addClient(owner, tenant, intent, correlation)).rejects.toThrow('NOT_AUTHORIZED');
    expect((await brands.overview(owner, client.organizationId)).role).toBe('OWNER');
    await service.setMode(owner, tenant, { enabled: true, revision: 2 }, correlation);
    await database.client`update users set email_verified_at=null where id=${owner}`;
    await expect(service.addClient(owner, tenant, intent, correlation)).rejects.toThrow('NOT_AUTHORIZED');
    await database.client`update users set email_verified_at=now(),disabled_at=now() where id=${owner}`;
    await expect(service.overview(owner, tenant)).rejects.toThrow('NOT_FOUND');
    await database.client`update users set disabled_at=null where id=${owner}`;
    await database.client`update organization_members set role='VIEWER' where tenant_id=${tenant} and user_id=${admin}`;
    await expect(service.overview(admin, tenant)).rejects.toThrow('NOT_AUTHORIZED');
  });
});
