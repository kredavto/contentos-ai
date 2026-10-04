import { randomUUID, randomBytes } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { BillingRepository, PaymentTaskRepository, RenewalRepository, createDatabase } from '../../packages/db/src/index';
import { CredentialVault } from '../../packages/core/src/credential-vault';
import { PaymentProcessor } from '../../packages/core/src/payment-processor';
import { ProviderRequestError, type PaymentProvider, type PaymentResult } from '../../packages/types/src/index';
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('durable payment dispatch', () => {
  if (url && !new URL(url).pathname.endsWith('_test')) throw new Error('Dedicated test database required');
  const database = createDatabase(url ?? 'postgresql://localhost/unused_test');
  afterAll(() => database.close());
  async function fixture(saving = false) {
    const tenantId = randomUUID(), owner = randomUUID(), correlation = randomUUID();
    await database.client`insert into users(id,email,password_hash,name,email_verified_at) values(${owner},${`task-${owner}@example.test`},'unusable','Owner',now())`;
    await database.client`insert into organizations(id,name) values(${tenantId},'Payment task fixture')`;
    await database.client`insert into organization_members(tenant_id,user_id,role) values(${tenantId},${owner},'OWNER')`;
    const [plan] = await database.client`update plans set enabled=true where code='AGENCY' returning id`;
    const versionId = randomUUID();
    await database.client`insert into plan_versions(id,plan_id,version,amount_minor,currency,ai_credits,video_seconds) select ${versionId},${plan!.id},coalesce(max(version),0)+1,499900,'RUB',20,30 from plan_versions where plan_id=${plan!.id}`;
    const billing = new BillingRepository(database.db), renewal = new RenewalRepository(database.db);
    let permission: {consentId:string;revision:number}|undefined;
    if (saving) {
      const policy = await renewal.preview(owner, tenantId, versionId);
      const change = await renewal.accept(owner, tenantId, { planVersionId: versionId, policyVersion: policy.policyVersion, textHash: policy.textHash, expectedRevision: policy.expectedRevision, accepted: true, idempotencyKey: randomUUID() }, { ip:'127.0.0.1',userAgent:'fixture' }, correlation);
      permission = { consentId: change.consentId!, revision: change.revision };
    }
    const merchant = { provider:'yookassa' as const, merchantId:'900500', test:true };
    const input = { returnUrl:'https://contentos.example/billing', receipt:{customerEmail:'tasks@example.test',vatCode:11,mode:'full_payment' as const,subject:'service' as const}, ...(permission ? {renewal:permission} : {}) };
    const order = await billing.checkout(owner, tenantId, versionId, randomUUID(), input, merchant, correlation);
    let now = new Date(Date.now()+1000);
    const tasks = new PaymentTaskRepository(database.db, () => now);
    const advance = (ms:number) => { now = new Date(now.getTime()+ms); };
    const externalId = randomUUID();
    const result:PaymentResult = { reference:{provider:'yookassa',externalId,internalId:order.id,metadata:{}}, observation:{...merchant,externalId,internalId:order.id,amountMinor:499900,currency:'RUB',status:'PENDING',paid:false}, confirmationUrl:'https://yoomoney.ru/checkout/fixture',savedPaymentMethodId:null,receiptStatus:null };
    const provider:PaymentProvider = {name:'yookassa',create:vi.fn(async()=>result),get:vi.fn(async()=>result),refund:vi.fn(),getRefund:vi.fn()};
    const processor = new PaymentProcessor(tasks,billing,provider,merchant,null);
    const row = async () => (await database.client`select * from payment_tasks where id=${order.id}`)[0]!;
    const claim = async () => (await tasks.claim(tenantId,order.id))!;
    const prepare = (token:string) => tasks.prepare(tenantId,order.id,token,merchant,true);
    const cancel = () => renewal.cancel(owner,tenantId,{expectedRevision:1,idempotencyKey:randomUUID()},correlation);
    return {tenantId,owner,order,tasks,billing,merchant,advance,provider,processor,result,row,claim,prepare,cancel};
  }
  it('creates an atomic outbox and claims duplicate deliveries once', async()=>{
    const f=await fixture(); expect((await f.row()).status).toBe('QUEUED');
    await database.client`update payment_tasks set next_attempt_at='1900-01-01T00:00:00Z' where id=${f.order.id}`;
    expect(await f.tasks.dispatchable()).toContainEqual({tenantId:f.tenantId,id:f.order.id});
    const claims=await Promise.all([f.claim(),f.claim()]); expect(claims.filter(Boolean)).toHaveLength(1);
    await f.tasks.dispatched(f.tenantId,f.order.id);
    expect(await f.tasks.dispatchable()).not.toContainEqual({tenantId:f.tenantId,id:f.order.id});
    await expect(f.tasks.prepare(randomUUID(),f.order.id,claims.find(Boolean)!.leaseToken!,f.merchant)).rejects.toThrow('NOT_FOUND');
  });
  it('persists a stable key/timestamp through crash recovery and fences stale workers',async()=>{
    const f=await fixture(), first=await f.claim(), original=await f.prepare(first.leaseToken!);
    expect(original?.mode).toBe('CREATE');
    f.advance(121000); const second=await f.claim(), replay=await f.prepare(second.leaseToken!);
    expect(replay?.mode).toBe('CREATE');
    if(original?.mode!=='CREATE'||replay?.mode!=='CREATE')throw new Error('Expected create');
    expect(replay.idempotencyKey).toBe(f.order.id);expect(replay.firstSubmittedAt).toEqual(original.firstSubmittedAt);
    await expect(f.tasks.observe(f.tenantId,f.order.id,first.leaseToken!,f.result.observation,null)).rejects.toThrow('CONFLICT');
    await expect(database.client`update payment_tasks set first_submitted_at=now() where id=${f.order.id}`).rejects.toThrow();
    expect((await f.row()).submission_count).toBe(2);
  });
  it('refuses unknown payment replay at the 23-hour boundary',async()=>{
    const f=await fixture(), first=await f.claim();await f.prepare(first.leaseToken!);
    f.advance(23*3600000);const second=await f.claim();expect(await f.prepare(second.leaseToken!)).toBeNull();
    expect((await f.row()).status).toBe('RECONCILIATION');expect((await f.row()).submission_count).toBe(1);
  });
  it('cancels queued saving checkout, including a claimed task before its send marker',async()=>{
    const f=await fixture(true), claimed=await f.claim();await f.cancel();
    expect((await f.row()).status).toBe('CANCELED');
    await expect(f.prepare(claimed.leaseToken!)).rejects.toThrow('CONFLICT');expect((await f.row()).first_submitted_at).toBeNull();
  });
  it('preserves uncertainty after cancellation and never replays an unknown sent charge',async()=>{
    const f=await fixture(true), first=await f.claim();await f.prepare(first.leaseToken!);await f.cancel();
    f.advance(121000);const second=await f.claim();expect(await f.prepare(second.leaseToken!)).toBeNull();expect((await f.row()).status).toBe('RECONCILIATION');
  });
  it('records pending identity, uses GET after expiry, and settles one time',async()=>{
    const f=await fixture();await f.processor.run(f.tenantId,f.order.id);
    expect(f.provider.create).toHaveBeenCalledTimes(1);expect((await f.row()).status).toBe('WAITING');
    f.advance(24*3600000);const paid={...f.result,observation:{...f.result.observation,status:'SUCCEEDED' as const,paid:true},confirmationUrl:null};
    vi.mocked(f.provider.get).mockResolvedValue(paid);
    await f.processor.run(f.tenantId,f.order.id);await f.processor.run(f.tenantId,f.order.id);
    expect(f.provider.create).toHaveBeenCalledTimes(1);expect(f.provider.get).toHaveBeenCalledTimes(1);expect((await f.row()).status).toBe('SUCCEEDED');
    expect(await database.client`select id from payment_settlements where tenant_id=${f.tenantId}`).toHaveLength(1);
    expect(await database.client`select id from usage_ledger where tenant_id=${f.tenantId} and type='PURCHASE'`).toHaveLength(2);
  });
  it('does not turn a rejection of an uncertain replay into proof of no payment',async()=>{
    const f=await fixture();vi.mocked(f.provider.create).mockRejectedValueOnce(new ProviderRequestError('PROVIDER_UNAVAILABLE',503,false)).mockRejectedValueOnce(new ProviderRequestError('PROVIDER_REJECTED',400,true));
    await f.processor.run(f.tenantId,f.order.id);f.advance(60000);await f.processor.run(f.tenantId,f.order.id);
    expect((await f.row()).status).toBe('WAITING');expect((await f.row()).submission_count).toBe(2);
    const g=await fixture();vi.mocked(g.provider.create).mockRejectedValue(new ProviderRequestError('PROVIDER_REJECTED',400,true));await g.processor.run(g.tenantId,g.order.id);expect((await g.row()).status).toBe('FAILED');
  });
  it('blocks owner revocation, merchant changes and saving without a vault before sending',async()=>{
    const f=await fixture();await database.client`update organization_members set role='EDITOR' where tenant_id=${f.tenantId}`;
    await f.processor.run(f.tenantId,f.order.id);expect(f.provider.create).not.toHaveBeenCalled();expect((await f.row()).status).toBe('CANCELED');
    const g=await fixture(), claimed=await g.claim();await expect(g.tasks.prepare(g.tenantId,g.order.id,claimed.leaseToken!,{...g.merchant,test:false})).rejects.toThrow('CONFIGURATION_REQUIRED');expect((await g.row()).first_submitted_at).toBeNull();
    const h=await fixture(true);await h.processor.run(h.tenantId,h.order.id);expect(h.provider.create).not.toHaveBeenCalled();expect((await h.row()).first_submitted_at).toBeNull();
  });
  it('reconciles a known payment after consent cancellation without submitting again',async()=>{
    const f=await fixture(true), claimed=await f.claim();await f.prepare(claimed.leaseToken!);
    await f.tasks.observe(f.tenantId,f.order.id,claimed.leaseToken!,f.result.observation,f.result.confirmationUrl);
    await f.tasks.finish(f.tenantId,f.order.id,claimed.leaseToken!);await f.cancel();f.advance(24*3600000);
    vi.mocked(f.provider.get).mockResolvedValue({...f.result,observation:{...f.result.observation,status:'SUCCEEDED',paid:true},confirmationUrl:null});
    await f.processor.run(f.tenantId,f.order.id);expect(f.provider.create).not.toHaveBeenCalled();expect(f.provider.get).toHaveBeenCalledTimes(1);expect((await f.row()).status).toBe('SUCCEEDED');
  });
  it('bounds uncertain submissions and leaves disabled configuration untouched',async()=>{
    const f=await fixture();const disabled=new PaymentProcessor(f.tasks,f.billing,null,null,null);await disabled.run(f.tenantId,f.order.id);expect((await f.row()).attempt).toBe(0);
    vi.mocked(f.provider.create).mockRejectedValue(new ProviderRequestError('PROVIDER_UNAVAILABLE',503,false));
    for(let i=0;i<6;i++){await f.processor.run(f.tenantId,f.order.id);f.advance(3600000);}
    expect(f.provider.create).toHaveBeenCalledTimes(5);expect((await f.row()).status).toBe('RECONCILIATION');
  });
  it('recovers a saved-method write failure by GET without charging or granting twice',async()=>{
    const f=await fixture(true), vault=new CredentialVault(JSON.stringify({fixture:randomBytes(32).toString('base64')}),'fixture');
    const processor=new PaymentProcessor(f.tasks,f.billing,f.provider,f.merchant,vault);
    const paid:PaymentResult={...f.result,observation:{...f.result.observation,status:'SUCCEEDED',paid:true},confirmationUrl:null,savedPaymentMethodId:'fixture-method'};
    vi.mocked(f.provider.create).mockResolvedValue(paid);vi.mocked(f.provider.get).mockResolvedValue(paid);
    vi.spyOn(f.billing,'attachSavedMethod').mockRejectedValueOnce(new Error('Fixture storage outage'));
    await processor.run(f.tenantId,f.order.id);expect((await f.row()).status).toBe('WAITING');
    expect(await database.client`select id from payment_settlements where tenant_id=${f.tenantId}`).toHaveLength(1);
    f.advance(60000);await processor.run(f.tenantId,f.order.id);
    expect(f.provider.create).toHaveBeenCalledTimes(1);expect(f.provider.get).toHaveBeenCalledTimes(1);expect((await f.row()).status).toBe('SUCCEEDED');
    expect(await database.client`select id from billing_payment_methods where tenant_id=${f.tenantId}`).toHaveLength(1);
    expect(await database.client`select id from usage_ledger where tenant_id=${f.tenantId} and type='PURCHASE'`).toHaveLength(2);
  });
  it('requires committed settlement before successful task completion and validates identity',async()=>{
    const f=await fixture(), claimed=await f.claim();await f.prepare(claimed.leaseToken!);
    await expect(f.tasks.observe(f.tenantId,f.order.id,claimed.leaseToken!,{...f.result.observation,amountMinor:1},null)).rejects.toThrow('CONFLICT');
    const paid={...f.result.observation,status:'SUCCEEDED' as const,paid:true};await f.tasks.observe(f.tenantId,f.order.id,claimed.leaseToken!,paid,null);
    await expect(f.tasks.finish(f.tenantId,f.order.id,claimed.leaseToken!)).rejects.toThrow('CONFLICT');
    await f.billing.settle(f.tenantId,f.order.id,paid);await f.tasks.finish(f.tenantId,f.order.id,claimed.leaseToken!);expect((await f.row()).status).toBe('SUCCEEDED');
  });
});
