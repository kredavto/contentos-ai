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
    expect(await database.client`select id from subscription_terms where tenant_id=${f.tenantId}`).toHaveLength(1);
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
    expect(await database.client`select id from subscription_terms where tenant_id=${f.tenantId}`).toHaveLength(0);
    expect(await database.client`select id from subscriptions where tenant_id=${f.tenantId}`).toHaveLength(0);
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
  it('creates paid monthly terms without February drift and separates current from prepaid periods', async () => {
    const f = await fixture(); let now = new Date('2027-01-31T12:30:00.000Z');
    const subscriptions = new BillingRepository(database.db, () => now);
    const first = await f.checkout(); await subscriptions.settle(f.tenantId, first.id, f.observation(first.id));
    now = new Date('2027-02-20T12:30:00.000Z');
    const second = await f.checkout(); await subscriptions.settle(f.tenantId, second.id, f.observation(second.id));
    const overview = await subscriptions.overview(f.owner, f.tenantId);
    expect(overview.status).toBe('ACTIVE'); expect(overview.current!.endsAt.toISOString()).toBe('2027-02-28T12:30:00.000Z');
    expect(overview.upcoming).toHaveLength(1); expect(overview.upcoming[0]!.endsAt.toISOString()).toBe('2027-03-31T12:30:00.000Z');
    expect(overview.upcoming[0]!.startsAt.toISOString()).toBe(overview.current!.endsAt.toISOString());
    expect(JSON.stringify(overview)).not.toContain('billing@example.test');
    await expect(subscriptions.overview(f.editor, f.tenantId)).rejects.toThrow('NOT_AUTHORIZED');
    await expect(database.client`delete from subscription_terms where tenant_id=${f.tenantId}`).rejects.toThrow();
    now = new Date('2027-03-01T00:00:00.000Z'); expect((await subscriptions.overview(f.owner, f.tenantId)).current!.orderId).toBe(second.id);
  });
  it('starts a fresh paid period after expiry without charging for the unpaid gap', async () => {
    const f = await fixture(); let now = new Date('2027-01-31T12:30:00.000Z');
    const subscriptions = new BillingRepository(database.db, () => now);
    const first = await f.checkout(); await subscriptions.settle(f.tenantId, first.id, f.observation(first.id));
    now = new Date('2027-04-03T12:30:00.000Z'); expect((await subscriptions.overview(f.owner, f.tenantId)).status).toBe('INACTIVE');
    const second = await f.checkout(); await subscriptions.settle(f.tenantId, second.id, f.observation(second.id));
    const current = (await subscriptions.overview(f.owner, f.tenantId)).current!;
    expect(current.startsAt.toISOString()).toBe(now.toISOString()); expect(current.endsAt.toISOString()).toBe('2027-05-03T12:30:00.000Z'); expect(current.monthIndex).toBe(1);
  });
  it('reconciles a pre-term settlement without minting credits or extending from replay time', async () => {
    const f = await fixture(), order = await f.checkout(), evidence = f.observation(order.id), paymentId = randomUUID();
    await database.client`insert into payments(id,tenant_id,order_id,provider,merchant_id,test,external_id) values(${paymentId},${f.tenantId},${order.id},'yookassa','100500',true,${evidence.externalId})`;
    await database.client`insert into payment_settlements(tenant_id,order_id,payment_id,observation,correlation_id,created_at) values(${f.tenantId},${order.id},${paymentId},${JSON.stringify(evidence)},${f.correlation},'2026-10-04T18:00:00Z')`;
    const replay = new BillingRepository(database.db, () => new Date('2027-04-03T12:00:00Z'));
    await replay.settle(f.tenantId, order.id, evidence); await replay.settle(f.tenantId, order.id, evidence);
    const overview = await replay.overview(f.owner, f.tenantId); expect(overview.status).toBe('INACTIVE'); expect(overview.history).toHaveLength(1);
    expect(overview.history[0]!.startsAt.toISOString()).toBe('2026-10-04T18:00:00.000Z'); expect(overview.history[0]!.endsAt.toISOString()).toBe('2026-11-04T18:00:00.000Z');
    expect(await database.client`select id from usage_ledger where tenant_id=${f.tenantId}`).toHaveLength(0);
  });
  it('rejects overlapping paid terms even for direct database inserts', async () => {
    const f = await fixture(), first = await f.checkout();
    await billing.settle(f.tenantId, first.id, f.observation(first.id));
    const second = await f.checkout(), evidence = f.observation(second.id), paymentId = randomUUID();
    await database.client`insert into payments(id,tenant_id,order_id,provider,merchant_id,test,external_id) values(${paymentId},${f.tenantId},${second.id},'yookassa','100500',true,${evidence.externalId})`;
    await database.client`insert into payment_settlements(tenant_id,order_id,payment_id,observation,correlation_id) values(${f.tenantId},${second.id},${paymentId},${JSON.stringify(evidence)},${f.correlation})`;
    await expect(database.client`insert into subscription_terms(tenant_id,subscription_id,order_id,plan_version_id,anchor_at,month_index,starts_at,ends_at) select tenant_id,subscription_id,${second.id},plan_version_id,anchor_at,month_index,starts_at,ends_at from subscription_terms where tenant_id=${f.tenantId}`).rejects.toThrow('Paid subscription terms cannot overlap');
  });
});
