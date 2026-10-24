import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { AdminRepository, BillingRepository } from '../../packages/db/src/index';
import { AdminService } from '../../packages/core/src/admin';
import { isolatedTestDatabase } from '../helpers/isolated-database';
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('operator pricing publication and immutable customer terms', () => {
  const database = isolatedTestDatabase(url), repository = new AdminRepository(database.db);
  const service = new AdminService(repository, true, []), billing = new BillingRepository(database.db);
  const admin = randomUUID(), support = randomUUID(), owner = randomUUID(), tenant = randomUUID(), correlation = randomUUID();
  const input = { code: 'START', name: 'Start fixture', enabled: true, expectedVersion: 0, amountMinor: 10000, currency: 'RUB', aiCredits: 30, videoSeconds: 60, ticket: 'PRICE-100', idempotencyKey: randomUUID() };
  let initialVersion = '';
  beforeAll(async () => {
    for (const id of [admin, support, owner]) await database.client`insert into users(id,email,name,password_hash,email_verified_at) values(${id},${`${id}@example.test`},'Pricing fixture','unusable',now())`;
    await database.client`insert into platform_operators(user_id,role) values(${admin},'ADMIN'),(${support},'SUPPORT')`;
    await database.client`insert into organizations(id,name) values(${tenant},'Pricing tenant')`;
    await database.client`insert into organization_members(tenant_id,user_id,role) values(${tenant},${owner},'OWNER')`;
  });
  it('lists unconfigured plans but denies tenant owners and support mutations', async () => {
    expect((await service.catalog(support, correlation)).plans).toHaveLength(5);
    expect((await service.catalog(admin, correlation)).plans.every(plan => plan.version === 0 && !plan.enabled)).toBe(true);
    await expect(service.catalog(owner, correlation)).rejects.toThrow('NOT_AUTHORIZED');
    for (const actor of [support, owner]) await expect(service.publishPlan(actor, input, correlation)).rejects.toThrow('NOT_AUTHORIZED');
    expect(() => new AdminService(repository, false, []).publishPlan(admin, input, correlation)).toThrow('CONFIGURATION_REQUIRED');
    for (const patch of [{ amountMinor: 0 }, { code: 'FREE', amountMinor: 10 }, { aiCredits: -1 }, { videoSeconds: 1.5 }, { amountMinor: 1000000001 }, { currency: 'USD' }, { unexpected: true }]) expect(() => service.publishPlan(admin, { ...input, ...patch }, correlation)).toThrow();
    expect(await database.client`select id from plan_versions`).toHaveLength(0);
  });
  it('serializes duplicate requests and binds their payload, with one immutable audit', async () => {
    const results = await Promise.all([service.publishPlan(admin, input, correlation), service.publishPlan(admin, input, correlation)]);
    expect(results[0]).toEqual(results[1]); initialVersion = results[0]!.planVersionId;
    expect(await database.client`select id from plan_versions`).toHaveLength(1);
    expect(await database.client`select id from audit_logs where action='ADMIN_PLAN_PUBLISHED'`).toHaveLength(1);
    await expect(service.publishPlan(admin, { ...input, amountMinor: 20000 }, correlation)).rejects.toThrow('CONFLICT');
    await expect(database.client`update platform_plan_changes set enabled=false where id=${results[0]!.id}`).rejects.toThrow();
    await expect(database.client`delete from platform_plan_changes where id=${results[0]!.id}`).rejects.toThrow();
    expect((await billing.catalog(owner, tenant))[0]?.planVersionId).toBe(initialVersion);
  });
  it('preserves paid and in-flight orders while refusing outdated new checkouts', async () => {
    const merchant = { provider: 'yookassa' as const, merchantId: '100500', test: true };
    const checkoutInput = { returnUrl: 'https://contentos.example/billing/return', receipt: { customerEmail: 'fixture@example.test', vatCode: 11, taxSystemCode: 1, mode: 'full_payment' as const, subject: 'service' as const } };
    const key = randomUUID();
    const paid = await billing.checkout(owner, tenant, initialVersion, key, checkoutInput, merchant, correlation);
    const pending = await billing.checkout(owner, tenant, initialVersion, randomUUID(), checkoutInput, merchant, correlation);
    const settle = (id: string) => billing.settle(tenant, id, { ...merchant, externalId: randomUUID(), internalId: id, amountMinor: 10000, currency: 'RUB', status: 'SUCCEEDED', paid: true });
    await settle(paid.id);
    const before = await database.client`select * from subscription_terms where tenant_id=${tenant}`;
    const next = await service.publishPlan(admin, { ...input, expectedVersion: 1, amountMinor: 25000, aiCredits: 80, videoSeconds: 180, idempotencyKey: randomUUID() }, correlation);
    expect(await database.client`select * from subscription_terms where tenant_id=${tenant}`).toEqual(before);
    const [frozen] = await database.client`select amount_minor,ai_credits,video_seconds from billing_orders where id=${paid.id}`;
    expect(frozen).toEqual({ amount_minor: 10000, ai_credits: 30, video_seconds: 60 });
    await expect(billing.checkout(owner, tenant, initialVersion, randomUUID(), checkoutInput, merchant, correlation)).rejects.toThrow('CONFLICT');
    expect((await billing.checkout(owner, tenant, initialVersion, key, checkoutInput, merchant, correlation)).id).toBe(paid.id);
    await settle(pending.id);
    expect((await database.client`select plan_version_id from subscription_terms where order_id=${pending.id}`)[0]?.plan_version_id).toBe(initialVersion);
    expect((await billing.catalog(owner, tenant))[0]?.planVersionId).toBe(next.planVersionId);
    expect((await service.publishPlan(admin, input, correlation)).planVersionId).toBe(initialVersion);
  });
  it('rejects stale simultaneous editors, including another ADMIN', async () => {
    const other = randomUUID();
    await database.client`insert into users(id,email,name,password_hash,email_verified_at) values(${other},${`${other}@example.test`},'Other admin','unusable',now())`;
    await database.client`insert into platform_operators(user_id,role) values(${other},'ADMIN')`;
    const results = await Promise.allSettled([admin, other].map(actor => service.publishPlan(actor, { ...input, expectedVersion: 2, idempotencyKey: randomUUID() }, correlation)));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect((await service.catalog(admin, correlation)).plans.find(plan => plan.code === 'START')?.version).toBe(3);
  });
  it('disables and re-enables the catalog through new versions without replacing history', async () => {
    await service.publishPlan(admin, { ...input, expectedVersion: 3, enabled: false, idempotencyKey: randomUUID() }, correlation);
    expect(await billing.catalog(owner, tenant)).toEqual([]);
    expect(await database.client`select id from subscription_terms where tenant_id=${tenant}`).toHaveLength(2);
    await expect(service.publishPlan(admin, { ...input, expectedVersion: 3, idempotencyKey: randomUUID() }, correlation)).rejects.toThrow('CONFLICT');
    await service.publishPlan(admin, { ...input, expectedVersion: 4, idempotencyKey: randomUUID() }, correlation);
    expect(await billing.catalog(owner, tenant)).toHaveLength(1);
    expect(await database.client`select id from plan_versions`).toHaveLength(5);
    await expect(database.client`update plan_versions set amount_minor=1 where id=${initialVersion}`).rejects.toThrow();
  });
  it('rechecks operator revocation even for a previously successful idempotent request', async () => {
    await database.client`update platform_operators set revoked_at=now() where user_id=${admin}`;
    await expect(service.publishPlan(admin, input, correlation)).rejects.toThrow('NOT_AUTHORIZED');
  });
});
