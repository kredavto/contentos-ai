import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { BillingRepository, createDatabase, RenewalRepository } from '../../packages/db/src/index';
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('explicit renewal consent and cancellation', () => {
  if (url && !new URL(url).pathname.endsWith('_test')) throw new Error('Dedicated test database required');
  const database = createDatabase(url ?? 'postgresql://localhost/unused_test'), renewal = new RenewalRepository(database.db), billing = new BillingRepository(database.db);
  afterAll(() => database.close());
  async function fixture() {
    const tenantId = randomUUID(), owner = randomUUID(), editor = randomUUID(), correlation = randomUUID();
    await database.client`insert into users(id,email,password_hash,name,email_verified_at) values(${owner},${`renewal-${owner}@example.test`},'unusable','Owner',now()),(${editor},${`renewal-${editor}@example.test`},'unusable','Editor',now())`;
    await database.client`insert into organizations(id,name) values(${tenantId},'Renewal fixture')`;
    await database.client`insert into organization_members(tenant_id,user_id,role) values(${tenantId},${owner},'OWNER'),(${tenantId},${editor},'EDITOR')`;
    const [plan] = await database.client`update plans set enabled=true where code='EXPERT' returning id`;
    const planVersionId = randomUUID();
    await database.client`insert into plan_versions(id,plan_id,version,amount_minor,currency,ai_credits,video_seconds) select ${planVersionId},${plan!.id},coalesce(max(version),0)+1,299900,'RUB',200,600 from plan_versions where plan_id=${plan!.id}`;
    const policy = await renewal.preview(owner, tenantId, planVersionId);
    const input = { planVersionId, policyVersion: policy.policyVersion, textHash: policy.textHash, expectedRevision: policy.expectedRevision, accepted: true as const, idempotencyKey: randomUUID() };
    const accept = (request = input) => renewal.accept(owner, tenantId, request, { ip: '192.0.2.1', userAgent: 'Renewal test fixture' }, correlation);
    return { tenantId, owner, editor, correlation, planVersionId, policy, input, accept };
  }
  it('requires the current explicit price policy and records one concurrent acceptance', async () => {
    const f = await fixture(); expect(f.policy.text).toContain('2999.00 RUB'); expect(f.policy.text).toContain('EXPERT'); expect(f.policy.expectedRevision).toBe(0);
    await expect(f.accept({ ...f.input, accepted: false } as unknown as typeof f.input)).rejects.toThrow();
    await expect(f.accept({ ...f.input, textHash: 'a'.repeat(64) })).rejects.toThrow('CONFLICT');
    const [a, b] = await Promise.all([f.accept(), f.accept()]); expect(a.id).toBe(b.id);
    const view = await renewal.overview(f.owner, f.tenantId); expect(view.revision).toBe(1); expect(view.active!.amountMinor).toBe(299900); expect(view.history).toHaveLength(1);
    expect(JSON.stringify(view)).not.toContain('192.0.2.1'); expect(JSON.stringify(view)).not.toContain('Renewal test fixture');
    await expect(database.client`update billing_renewal_consents set amount_minor=1 where id=${a.consentId}`).rejects.toThrow();
    await expect(database.client`delete from billing_renewal_changes where id=${a.id}`).rejects.toThrow();
  });
  it('cancels once, preserves paid access and old acceptance replay cannot re-enable', async () => {
    const f = await fixture(), enabled = await f.accept();
    const order = await billing.checkout(f.owner, f.tenantId, f.planVersionId, randomUUID(), { returnUrl: 'https://contentos.example/billing', receipt: { customerEmail: 'fixture@example.test', vatCode: 11, mode: 'full_payment', subject: 'service' } }, { provider: 'yookassa', merchantId: '100500', test: true }, f.correlation);
    await billing.settle(f.tenantId, order.id, { provider: 'yookassa', merchantId: '100500', test: true, internalId: order.id, externalId: randomUUID(), amountMinor: 299900, currency: 'RUB', status: 'SUCCEEDED', paid: true });
    const paidBefore = await billing.overview(f.owner, f.tenantId), input = { expectedRevision: 1, idempotencyKey: randomUUID() };
    const [a, b] = await Promise.all([renewal.cancel(f.owner, f.tenantId, input, f.correlation), renewal.cancel(f.owner, f.tenantId, input, f.correlation)]); expect(a.id).toBe(b.id);
    expect((await f.accept()).id).toBe(enabled.id);
    const view = await renewal.overview(f.owner, f.tenantId); expect(view.active).toBeNull(); expect(view.revision).toBe(2); expect(view.history.map(row => row.operation)).toEqual(['DISABLE', 'ENABLE']);
    expect(await billing.overview(f.owner, f.tenantId)).toEqual(paidBefore);
  });
  it('old cancellation replay cannot disable a newly accepted mandate', async () => {
    const f = await fixture(); await f.accept();
    const cancel = { expectedRevision: 1, idempotencyKey: randomUUID() }; await renewal.cancel(f.owner, f.tenantId, cancel, f.correlation);
    const fresh = await f.accept({ ...f.input, expectedRevision: 2, idempotencyKey: randomUUID() });
    await renewal.cancel(f.owner, f.tenantId, cancel, f.correlation);
    const view = await renewal.overview(f.owner, f.tenantId); expect(view.revision).toBe(3); expect(view.active!.id).toBe(fresh.consentId);
  });
  it('fences racing revisions and changed intent reuse', async () => {
    const f = await fixture();
    const requests = [f.input, { ...f.input, idempotencyKey: randomUUID() }];
    const results = await Promise.allSettled(requests.map(input => f.accept(input))); expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1);
    await expect(renewal.cancel(f.owner, f.tenantId, { expectedRevision: 0, idempotencyKey: randomUUID() }, f.correlation)).rejects.toThrow('CONFLICT');
    await expect(f.accept({ ...requests[results.findIndex(row => row.status === 'fulfilled')]!, expectedRevision: 1 })).rejects.toThrow('CONFLICT');
  });
  it('does not reuse stale price consent after the quote changes', async () => {
    const f = await fixture();
    await database.client`insert into plan_versions(plan_id,version,amount_minor,currency,ai_credits,video_seconds) select plan_id,version+1,399900,'RUB',300,900 from plan_versions where id=${f.planVersionId}`;
    await expect(f.accept()).rejects.toThrow('CONFLICT'); expect((await renewal.overview(f.owner, f.tenantId)).active).toBeNull();
  });
  it('checks owner permissions and tenant-scoped consent references', async () => {
    const f = await fixture(), other = await fixture(), consent = await other.accept();
    await expect(renewal.preview(f.editor, f.tenantId, other.planVersionId)).rejects.toThrow('NOT_AUTHORIZED');
    await expect(renewal.overview(f.owner, other.tenantId)).rejects.toThrow('NOT_FOUND');
    await expect(database.client`insert into billing_renewal_preferences(tenant_id,active_consent_id,revision) values(${f.tenantId},${consent.consentId},1)`).rejects.toThrow();
  });
});
