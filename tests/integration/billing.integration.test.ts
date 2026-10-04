import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { BillingRepository, createDatabase, LedgerRepository } from '../../packages/db/src/index';
import type { PaymentObservation } from '../../packages/types/src/index';
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('billing orders and atomic payment settlement', () => {
  if (url && !new URL(url).pathname.endsWith('_test')) throw new Error('Dedicated test database required');
  const database = createDatabase(url ?? 'postgresql://localhost/unused_test');
  const billing = new BillingRepository(database.db), ledger = new LedgerRepository(database.db);
  afterAll(() => database.close());
  async function fixture() {
    const tenantId = randomUUID(), owner = randomUUID(), editor = randomUUID(), correlation = randomUUID();
    await database.client`insert into users(id,email,password_hash,name,email_verified_at) values(${owner},${`billing-${owner}@example.test`},'unusable','Owner',now()),(${editor},${`billing-${editor}@example.test`},'unusable','Editor',now())`;
    await database.client`insert into organizations(id,name) values(${tenantId},'Billing fixture')`;
    await database.client`insert into organization_members(tenant_id,user_id,role) values(${tenantId},${owner},'OWNER'),(${tenantId},${editor},'EDITOR')`;
    const [plan] = await database.client`update plans set enabled=true where code='CREATOR' returning id`;
    const planVersionId = randomUUID();
    await database.client`insert into plan_versions(id,plan_id,version,amount_minor,currency,ai_credits,video_seconds) select ${planVersionId},${plan!.id},coalesce(max(version),0)+1,199900,'RUB',100,300 from plan_versions where plan_id=${plan!.id}`;
    const input = { returnUrl: 'https://contentos.example/billing/return', receipt: { customerEmail: 'billing@example.test', vatCode: 11, taxSystemCode: 1, mode: 'full_payment' as const, subject: 'service' as const } };
    const merchant = { provider: 'yookassa' as const, merchantId: '100500', test: true };
    const checkout = (key = randomUUID(), user = owner) => billing.checkout(user, tenantId, planVersionId, key, input, merchant, correlation);
    const observation = (orderId: string): PaymentObservation => ({ ...merchant, externalId: randomUUID(), internalId: orderId, amountMinor: 199900, currency: 'RUB', status: 'SUCCEEDED', paid: true });
    return { tenantId, owner, editor, correlation, input, merchant, planVersionId, checkout, observation };
  }
  it('serializes repeated checkout and rejects changed intents or non-owner access', async () => {
    const f = await fixture(), key = randomUUID();
    const [a, b] = await Promise.all([f.checkout(key), f.checkout(key)]); expect(a.id).toBe(b.id);
    expect(a.input.amountMinor).toBe(199900); expect(a.aiCredits).toBe(100);
    await expect(f.checkout(randomUUID(), f.editor)).rejects.toThrow('NOT_AUTHORIZED');
    await expect(billing.checkout(f.owner, f.tenantId, f.planVersionId, key, { ...f.input, returnUrl: 'https://contentos.example/changed' }, f.merchant, f.correlation)).rejects.toThrow('CONFLICT');
    await expect(database.client`update billing_orders set amount_minor=1 where id=${a.id}`).rejects.toThrow();
    await expect(database.client`delete from plan_versions where id=${f.planVersionId}`).rejects.toThrow();
  });
  it('settles concurrent notifications once and grants both units atomically', async () => {
    const f = await fixture(), order = await f.checkout(), evidence = f.observation(order.id);
    const results = await Promise.all([billing.settle(f.tenantId, order.id, evidence), billing.settle(f.tenantId, order.id, evidence)]);
    expect(results[0].id).toBe(results[1].id);
    const balance = await ledger.overview(f.owner, f.tenantId); expect(balance.balances.AI_CREDITS.available).toBe(100); expect(balance.balances.VIDEO_SECONDS.available).toBe(300);
    const rows = await database.client`select * from usage_ledger where tenant_id=${f.tenantId} and type='PURCHASE'`; expect(rows).toHaveLength(2);
    await expect(database.client`update payment_settlements set observation='{}' where id=${results[0].id}`).rejects.toThrow();
    await expect(billing.settle(f.tenantId, order.id, { ...evidence, externalId: randomUUID() })).rejects.toThrow('CONFLICT');
  });
  it('rejects unpaid, wrong amount, merchant, mode and organization evidence', async () => {
    const f = await fixture(), order = await f.checkout(), evidence = f.observation(order.id), other = await fixture();
    for (const patch of [{ paid: false }, { amountMinor: 1 }, { merchantId: '200500' }, { test: false }, { status: 'WAITING_CAPTURE' as const }, { internalId: randomUUID() }]) await expect(billing.settle(f.tenantId, order.id, { ...evidence, ...patch })).rejects.toThrow('CONFLICT');
    await expect(billing.settle(other.tenantId, order.id, evidence)).rejects.toThrow('NOT_FOUND');
    const balance = await ledger.overview(f.owner, f.tenantId); expect(balance.balances.AI_CREDITS.available).toBe(0);
    await expect(database.client`insert into payments(tenant_id,order_id,provider,merchant_id,test,external_id) values(${other.tenantId},${order.id},'yookassa','100500',true,${randomUUID()})`).rejects.toThrow();
  });
  it('prevents the same external payment being credited to another order', async () => {
    const f = await fixture(), first = await f.checkout(), second = await f.checkout(), evidence = f.observation(first.id);
    await billing.settle(f.tenantId, first.id, evidence);
    await expect(billing.settle(f.tenantId, second.id, { ...evidence, internalId: second.id })).rejects.toThrow();
    expect((await ledger.overview(f.owner, f.tenantId)).balances.AI_CREDITS.available).toBe(100);
    const [count] = await database.client`select count(*)::int as count from payment_settlements where tenant_id=${f.tenantId}`; expect(count!.count).toBe(1);
  });
  it('rolls back payment and settlement if either ledger insertion fails', async () => {
    const f = await fixture(), order = await f.checkout();
    await database.client`insert into usage_ledger(tenant_id,unit,type,amount,available_delta,reserved_delta,idempotency_key,correlation_id) values(${f.tenantId},'VIDEO_SECONDS','GRANT',1,1,0,${`payment:${order.id}:VIDEO_SECONDS`},${f.correlation})`;
    await expect(billing.settle(f.tenantId, order.id, f.observation(order.id))).rejects.toThrow();
    expect((await ledger.overview(f.owner, f.tenantId)).balances.AI_CREDITS.available).toBe(0);
    expect(await database.client`select id from payment_settlements where tenant_id=${f.tenantId}`).toHaveLength(0);
    expect(await database.client`select id from payments where tenant_id=${f.tenantId}`).toHaveLength(0);
  });
  it('rejects an outdated quote but preserves exact retries of an existing order', async () => {
    const f = await fixture(), key = randomUUID(), original = await f.checkout(key);
    await database.client`insert into plan_versions(plan_id,version,amount_minor,currency,ai_credits,video_seconds) select plan_id,version+1,299900,'RUB',200,600 from plan_versions where id=${f.planVersionId}`;
    await expect(f.checkout()).rejects.toThrow('CONFLICT');
    expect((await f.checkout(key)).id).toBe(original.id);
  });
  it('keeps cumulative balances exact beyond a PostgreSQL int32', async () => {
    const f = await fixture();
    for (let i = 0; i < 3; i++) await ledger.adjust(f.tenantId, 'AI_CREDITS', 1_000_000_000, `large-grant-${i}`, f.correlation);
    const order = await f.checkout(); await billing.settle(f.tenantId, order.id, f.observation(order.id));
    expect((await ledger.overview(f.owner, f.tenantId)).balances.AI_CREDITS.available).toBe(3_000_000_100);
  });
});
