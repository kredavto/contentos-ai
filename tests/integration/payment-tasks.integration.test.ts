import { randomUUID, randomBytes } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { RenewalBillingRepository, PaymentWebhookRepository, BillingRepository, PaymentTaskRepository, RenewalRepository, createDatabase } from '../../packages/db/src/index';
import { BillingService } from '../../packages/core/src/billing';
import { PaymentWebhookProcessor, PaymentWebhookService } from '../../packages/core/src/payment-webhooks';
import { YooKassaPaymentProvider } from '../../packages/providers/src/yookassa';
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
    const provider:PaymentProvider = {name:'yookassa',inspect:vi.fn(async()=>result),create:vi.fn(async()=>result),get:vi.fn(async()=>result),refund:vi.fn(),getRefund:vi.fn()};
    const processor = new PaymentProcessor(tasks,billing,provider,merchant,null);
    const row = async () => (await database.client`select * from payment_tasks where id=${order.id}`)[0]!;
    const claim = async () => (await tasks.claim(tenantId,order.id))!;
    const prepare = (token:string) => tasks.prepare(tenantId,order.id,token,merchant,true);
    const cancel = () => renewal.cancel(owner,tenantId,{expectedRevision:1,idempotencyKey:randomUUID()},correlation);
    return {clock:()=>now,versionId,tenantId,owner,order,tasks,billing,merchant,advance,provider,processor,result,row,claim,prepare,cancel};
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
  it('passes merchant scope to the real YooKassa adapter when polling known checkout',async()=>{
    const f=await fixture();let paid=false;
    const http=vi.fn<typeof fetch>(async()=>Response.json({id:f.result.observation.externalId,status:paid?'succeeded':'pending',paid,amount:{value:'4999.00',currency:'RUB'},recipient:{account_id:f.merchant.merchantId},test:true,metadata:{order_id:f.order.id},...(!paid?{confirmation:{type:'redirect',confirmation_url:f.result.confirmationUrl}}:{})}));
    const provider=new YooKassaPaymentProvider({shopId:f.merchant.merchantId,secretKey:'fixture-secret',test:true,returnOrigin:'https://contentos.example'},http);
    const processor=new PaymentProcessor(f.tasks,f.billing,provider,f.merchant,null);
    await processor.run(f.tenantId,f.order.id);paid=true;f.advance(60000);await processor.run(f.tenantId,f.order.id);
    expect(http).toHaveBeenCalledTimes(2);expect(http.mock.calls[1]![1]!.method).toBe('GET');expect((await f.row()).status).toBe('SUCCEEDED');
  });
  async function webhookFixture(){
    const f=await fixture(),repository=new PaymentWebhookRepository(database.db,f.clock),service=new PaymentWebhookService(repository,f.merchant);
    const processor=new PaymentWebhookProcessor(repository,f.billing,f.provider,f.merchant,null);
    const notification={type:'notification',event:'payment.succeeded',object:{id:f.result.observation.externalId,paid:true,amount:{value:'9999999.99'},metadata:{order_id:randomUUID()},payment_method:{card:{last4:'1234'}}}};
    const receive=async(raw:unknown=notification)=>{await service.receive(raw,randomUUID());return (await database.client`select * from webhook_events where external_id=${f.result.observation.externalId}`)[0]!;};
    const eventRow=async(id:string)=>(await database.client`select * from webhook_events where id=${id}`)[0]!;
    const submitted=async()=>{const task=await f.claim();await f.prepare(task.leaseToken!);await f.tasks.fail(f.tenantId,f.order.id,task.leaseToken!,false);};
    return {...f,repository,service,webhookProcessor:processor,notification,receive,eventRow,submitted};
  }
  it('persists minimal deduplicated receipts and never trusts a claimed paid body',async()=>{
    const f=await webhookFixture();await f.submitted();const [a,b]=await Promise.all([f.receive(),f.receive()]);expect(a.id).toBe(b.id);
    expect(JSON.stringify(a)).not.toContain('1234');expect(JSON.stringify(a)).not.toContain('9999999');
    await f.webhookProcessor.run(a.id);expect(f.provider.inspect).toHaveBeenCalledTimes(1);
    expect(await database.client`select id from payment_settlements where tenant_id=${f.tenantId}`).toHaveLength(0);expect((await f.eventRow(a.id)).status).toBe('RETRY');
    vi.mocked(f.provider.inspect).mockResolvedValue({...f.result,observation:{...f.result.observation,status:'SUCCEEDED',paid:true},confirmationUrl:null});f.advance(60000);
    await f.webhookProcessor.run(a.id);await f.webhookProcessor.run(a.id);expect((await f.eventRow(a.id)).status).toBe('PROCESSED');
    expect(await database.client`select id from payment_settlements where tenant_id=${f.tenantId}`).toHaveLength(1);
    expect(await database.client`select id from usage_ledger where tenant_id=${f.tenantId} and type='PURCHASE'`).toHaveLength(2);
    await expect(database.client`update webhook_events set external_id=${randomUUID()} where id=${a.id}`).rejects.toThrow();
  });
  it('recovers a lost create response after replay expiry using authenticated webhook lookup',async()=>{
    const f=await webhookFixture();await f.submitted();f.advance(24*3600000);
    const task=await f.claim();expect(await f.prepare(task.leaseToken!)).toBeNull();expect((await f.row()).status).toBe('RECONCILIATION');
    vi.mocked(f.provider.inspect).mockResolvedValue({...f.result,observation:{...f.result.observation,status:'SUCCEEDED',paid:true},confirmationUrl:null});
    const event=await f.receive();await f.webhookProcessor.run(event.id);expect((await f.eventRow(event.id)).status).toBe('PROCESSED');
    expect(f.provider.create).not.toHaveBeenCalled();expect(await database.client`select id from payment_settlements where tenant_id=${f.tenantId}`).toHaveLength(1);
  });
  it('rejects wrong merchant, amount, external identity and never-sent orders',async()=>{
    const f=await webhookFixture(),event=await f.receive();
    const claimed=await f.repository.claim(event.id,f.merchant);expect(claimed).toBeTruthy();
    for(const patch of [{merchantId:'123'},{amountMinor:1},{externalId:randomUUID()},{test:false},{}])await expect(f.repository.reconcile(event.id,claimed!.leaseToken!,{...f.result.observation,...patch},null)).rejects.toThrow('CONFLICT');
    expect(await database.client`select id from payments where tenant_id=${f.tenantId}`).toHaveLength(0);
  });
  it('waits for an active checkout lease and fences stale webhook workers',async()=>{
    const f=await webhookFixture(),task=await f.claim();await f.prepare(task.leaseToken!);const event=await f.receive();
    const first=await f.repository.claim(event.id,f.merchant);expect(await f.repository.claim(event.id,f.merchant)).toBeNull();
    await expect(f.repository.reconcile(event.id,first!.leaseToken!,f.result.observation,null)).rejects.toThrow('CONFLICT');
    f.advance(121000);const second=await f.repository.claim(event.id,f.merchant);
    await expect(f.repository.finish(event.id,first!.leaseToken!,'PROCESSED')).rejects.toThrow('CONFLICT');
    expect(await f.repository.reconcile(event.id,second!.leaseToken!,f.result.observation,null)).toEqual({tenantId:f.tenantId,orderId:f.order.id});
  });
  it('rearms a bounded unresolved receipt on redelivery without retaining forged order hints',async()=>{
    const f=await webhookFixture(),event=await f.receive();await database.client`update webhook_events set attempt=24 where id=${event.id}`;
    expect(await f.repository.claim(event.id,f.merchant)).toBeNull();expect((await f.eventRow(event.id)).status).toBe('RECONCILIATION');
    await f.receive();expect((await f.eventRow(event.id)).status).toBe('RETRY');expect((await f.eventRow(event.id)).attempt).toBe(0);
    const disabled=new PaymentWebhookService(f.repository,null);await expect(disabled.receive(f.notification,randomUUID())).rejects.toThrow('CONFIGURATION_REQUIRED');
    await expect(f.receive({...f.notification,event:'refund.succeeded'})).rejects.toThrow();
  });

  it('serves owner-only prices/status and creates checkout from server-owned fiscal fields',async()=>{
    const f=await fixture(),renewal=new RenewalRepository(database.db);
    const service=new BillingService(f.billing,renewal,{merchant:f.merchant,appUrl:'https://contentos.example',receipt:{vatCode:11,subject:'service',mode:'full_payment'}});
    const overview=await service.overview(f.owner,f.tenantId);expect(overview.plans.some(plan=>plan.planVersionId===f.versionId)).toBe(true);expect(overview.checkoutStatus).toBe('READY');
    const intent={planVersionId:f.versionId,idempotencyKey:randomUUID()};
    const first=await service.checkout(f.owner,f.tenantId,intent,randomUUID()),second=await service.checkout(f.owner,f.tenantId,intent,randomUUID());expect(first.id).toBe(second.id);expect(first.status).toBe('QUEUED');
    const [stored]=await database.client`select input from billing_orders where id=${first.id}`;
    expect(stored!.input.receipt.customerEmail).toBe(`task-${f.owner}@example.test`);expect(stored!.input.saveMethod).toBe(false);expect(new URL(stored!.input.returnUrl).pathname).toBe('/billing');
    expect(JSON.stringify(first)).not.toContain('@example.test');expect(JSON.stringify(first)).not.toContain('merchant');
    await expect(service.checkout(f.owner,f.tenantId,{...intent,amountMinor:1},randomUUID())).rejects.toThrow();
    await expect(service.checkout(f.owner,f.tenantId,{...intent,returnUrl:'https://evil.example'},randomUUID())).rejects.toThrow();
    const other=await fixture();await expect(service.orderStatus(other.owner,other.tenantId,first.id)).rejects.toThrow('NOT_FOUND');
    await database.client`update organization_members set role='EDITOR' where tenant_id=${f.tenantId}`;
    await expect(service.overview(f.owner,f.tenantId)).rejects.toThrow('NOT_AUTHORIZED');await expect(service.orderStatus(f.owner,f.tenantId,first.id)).rejects.toThrow('NOT_AUTHORIZED');
  });
  it('shows paid status from committed settlement and keeps checkout disabled without fiscal configuration',async()=>{
    const f=await fixture(),service=new BillingService(f.billing,new RenewalRepository(database.db),null);
    expect((await service.overview(f.owner,f.tenantId)).checkoutStatus).toBe('CONFIGURATION_REQUIRED');
    await expect(service.checkout(f.owner,f.tenantId,{planVersionId:f.versionId,idempotencyKey:randomUUID()},randomUUID())).rejects.toThrow('CONFIGURATION_REQUIRED');
    await f.billing.settle(f.tenantId,f.order.id,{...f.result.observation,status:'SUCCEEDED',paid:true});
    const status=await service.orderStatus(f.owner,f.tenantId,f.order.id);expect(status.status).toBe('PAID');expect(status.confirmationUrl).toBeNull();
  });

  it('requires explicit exact consent for saving checkout and preserves both retry intents',async()=>{
    const f=await fixture(),renewal=new RenewalRepository(database.db),service=new BillingService(f.billing,renewal,{merchant:f.merchant,appUrl:'https://contentos.example',receipt:{vatCode:11,subject:'service',mode:'full_payment'}},true);
    const policy=await service.renewalPolicy(f.owner,f.tenantId,f.versionId);
    const acceptance={planVersionId:f.versionId,policyVersion:policy.policyVersion,textHash:policy.textHash,expectedRevision:policy.expectedRevision,accepted:true,idempotencyKey:randomUUID()},request={ip:'127.0.0.1',userAgent:'fixture'};
    await expect(service.acceptRenewal(f.owner,f.tenantId,{...acceptance,accepted:false},request,randomUUID())).rejects.toThrow();
    await expect(service.acceptRenewal(f.owner,f.tenantId,{...acceptance,textHash:'0'.repeat(64)},request,randomUUID())).rejects.toThrow('CONFLICT');
    const permission=await service.acceptRenewal(f.owner,f.tenantId,acceptance,request,randomUUID());
    expect(await service.acceptRenewal(f.owner,f.tenantId,acceptance,request,randomUUID())).toEqual(permission);
    const intent={planVersionId:f.versionId,idempotencyKey:randomUUID(),renewal:permission};
    const order=await service.checkout(f.owner,f.tenantId,intent,randomUUID());
    expect((await service.checkout(f.owner,f.tenantId,intent,randomUUID())).id).toBe(order.id);
    const [row]=await database.client`select input,renewal_consent_id from billing_orders where id=${order.id}`;expect(row!.input.saveMethod).toBe(true);expect(row!.renewal_consent_id).toBe(permission.consentId);
    expect((await service.overview(f.owner,f.tenantId)).renewal.methodReady).toBe(false);
    await service.cancelRenewal(f.owner,f.tenantId,{expectedRevision:permission.revision,idempotencyKey:randomUUID()},randomUUID());
    await expect(service.checkout(f.owner,f.tenantId,{...intent,idempotencyKey:randomUUID()},randomUUID())).rejects.toThrow('CONSENT_REQUIRED');
    expect((await service.orderStatus(f.owner,f.tenantId,order.id)).status).toBe('CANCELED');
  });
  it('denies opt-in without configuration and scopes policy/acceptance to verified owners',async()=>{
    const f=await fixture(),renewal=new RenewalRepository(database.db),configuration={merchant:f.merchant,appUrl:'https://contentos.example',receipt:{vatCode:11,subject:'service' as const,mode:'full_payment' as const}};
    const disabled=new BillingService(f.billing,renewal,configuration),service=new BillingService(f.billing,renewal,configuration,true);
    await expect(disabled.renewalPolicy(f.owner,f.tenantId,f.versionId)).rejects.toThrow('CONFIGURATION_REQUIRED');
    const policy=await service.renewalPolicy(f.owner,f.tenantId,f.versionId),input={planVersionId:f.versionId,policyVersion:policy.policyVersion,textHash:policy.textHash,expectedRevision:0,accepted:true,idempotencyKey:randomUUID()};
    await expect(disabled.acceptRenewal(f.owner,f.tenantId,input,{ip:'',userAgent:''},randomUUID())).rejects.toThrow('CONFIGURATION_REQUIRED');
    await expect(disabled.checkout(f.owner,f.tenantId,{planVersionId:f.versionId,idempotencyKey:randomUUID(),renewal:{consentId:randomUUID(),revision:1}},randomUUID())).rejects.toThrow('CONFIGURATION_REQUIRED');
    await database.client`update organization_members set role='EDITOR' where tenant_id=${f.tenantId}`;
    await expect(service.renewalPolicy(f.owner,f.tenantId,f.versionId)).rejects.toThrow('NOT_AUTHORIZED');
    await expect(service.acceptRenewal(f.owner,f.tenantId,input,{ip:'',userAgent:''},randomUUID())).rejects.toThrow('NOT_AUTHORIZED');
  });
  it('shows only usable merchant-scoped method readiness and clears it on cancellation',async()=>{
    const f=await recurringFixture(),renewal=new RenewalRepository(database.db);
    const overview=await renewal.overview(f.owner,f.tenantId,f.merchant);expect(overview.methodReady).toBe(true);expect(overview.nextPaymentAt).toEqual(new Date(f.term.ends_at));
    expect(JSON.stringify(overview)).not.toContain('fixture-recurring-method');expect(JSON.stringify(overview)).not.toContain('credential');
    expect((await renewal.overview(f.owner,f.tenantId,{...f.merchant,test:false})).methodReady).toBe(false);
    await f.cancel();const canceled=await renewal.overview(f.owner,f.tenantId,f.merchant);expect(canceled.methodReady).toBe(false);expect(canceled.nextPaymentAt).toBeNull();
  });

  async function recurringFixture(anchor?:Date){
    const f=await fixture(true),vault=new CredentialVault(JSON.stringify({fixture:randomBytes(32).toString('base64')}),'fixture');
    const initialBilling=anchor?new BillingRepository(database.db,()=>anchor):f.billing;
    const processor=new PaymentProcessor(f.tasks,initialBilling,f.provider,f.merchant,vault,true);
    const paid:PaymentResult={...f.result,observation:{...f.result.observation,status:'SUCCEEDED',paid:true},confirmationUrl:null,savedPaymentMethodId:'fixture-recurring-method'};
    vi.mocked(f.provider.create).mockResolvedValue(paid);await processor.run(f.tenantId,f.order.id);
    const [term]=await database.client`select * from subscription_terms where order_id=${f.order.id}`;
    const renewal=new RenewalBillingRepository(database.db,f.clock),fiscal={vatCode:11,subject:'service' as const,mode:'full_payment' as const};
    const schedule=()=>renewal.schedule(f.tenantId,f.merchant,fiscal);
    const due=()=>f.advance(new Date(term!.ends_at).getTime()-f.clock().getTime()+1000);
    return {...f,vault,processor,paid,term:term!,renewal,fiscal,schedule,due};
  }
  it('schedules one renewal per paid term, freezes its price, and never stores the raw method',async()=>{
    const f=await recurringFixture();expect(await f.schedule()).toBeNull();f.due();
    await database.client`insert into plan_versions(plan_id,version,amount_minor,currency,ai_credits,video_seconds) select plan_id,version+1,999900,'RUB',200,300 from plan_versions where id=${f.versionId}`;
    expect(await f.renewal.due(f.merchant)).toContainEqual({tenantId:f.tenantId});
    const [a,b]=await Promise.all([f.schedule(),f.schedule()]);expect(a!.orderId).toBe(b!.orderId);
    const [order]=await database.client`select * from billing_orders where id=${a!.orderId}`;expect(order!.amount_minor).toBe(499900);expect(order!.input.mode).toBe('RENEWAL');expect(order!.input.paymentMethodId).toBeUndefined();
    expect(JSON.stringify(order)).not.toContain('fixture-recurring-method');expect(await f.renewal.due(f.merchant)).not.toContainEqual({tenantId:f.tenantId});
    await expect(database.client`update billing_renewal_intents set method_id=${randomUUID()} where order_id=${a!.orderId}`).rejects.toThrow();
  });
  it('decrypts a bound method only for provider submission and settles renewal once',async()=>{
    const f=await recurringFixture();f.due();const intent=await f.schedule();
    const id=intent!.orderId;vi.mocked(f.provider.create).mockImplementation(async(_input,context)=>({...f.paid,reference:{...f.paid.reference,internalId:context.internalId,externalId:id},observation:{...f.paid.observation,internalId:context.internalId,externalId:id}}));
    // Settlement clock follows simulated processing time; renewal keeps its calendar anchor.
    const billing=new BillingRepository(database.db,f.clock),processor=new PaymentProcessor(f.tasks,billing,f.provider,f.merchant,f.vault,true);
    await processor.run(f.tenantId,id);await processor.run(f.tenantId,id);
    expect(f.provider.create).toHaveBeenCalledTimes(2);expect(vi.mocked(f.provider.create).mock.calls[1]![0]).toMatchObject({mode:'RENEWAL',paymentMethodId:'fixture-recurring-method',amountMinor:499900});
    expect(await database.client`select id from subscription_terms where tenant_id=${f.tenantId}`).toHaveLength(2);expect(await database.client`select id from usage_ledger where tenant_id=${f.tenantId} and type='PURCHASE'`).toHaveLength(4);
    expect(await f.schedule()).toBeNull();
  });
  it('blocks canceled permission, wrong merchant, missing feature flag and overdue catch-up',async()=>{
    const f=await recurringFixture();f.due();expect(await f.renewal.schedule(f.tenantId,{...f.merchant,merchantId:'123'},f.fiscal)).toBeNull();
    const intent=await f.schedule(),disabled=new PaymentProcessor(f.tasks,f.billing,f.provider,f.merchant,f.vault);
    await disabled.run(f.tenantId,intent!.orderId);expect(f.provider.create).toHaveBeenCalledTimes(1);
    const [task]=await database.client`select * from payment_tasks where id=${intent!.orderId}`;expect(task!.first_submitted_at).toBeNull();
    await f.cancel();f.advance(60000);await f.processor.run(f.tenantId,intent!.orderId);expect(f.provider.create).toHaveBeenCalledTimes(1);
    const g=await recurringFixture();g.due();g.advance(72*3600000);expect(await g.schedule()).toBeNull();
  });
  it('stops a queued renewal if a manual payment extends the paid period first',async()=>{
    const f=await recurringFixture();f.due();const intent=await f.schedule();
    const [source]=await database.client`select input from billing_orders where id=${f.order.id}`;
    const manual=await f.billing.checkout(f.owner,f.tenantId,f.versionId,randomUUID(),{returnUrl:source!.input.returnUrl,receipt:source!.input.receipt},f.merchant,randomUUID());
    const billing=new BillingRepository(database.db,f.clock);await billing.settle(f.tenantId,manual.id,{...f.paid.observation,internalId:manual.id,externalId:randomUUID()});
    await f.processor.run(f.tenantId,intent!.orderId);expect(f.provider.create).toHaveBeenCalledTimes(1);
    const [task]=await database.client`select status from payment_tasks where id=${intent!.orderId}`;expect(task!.status).toBe('CANCELED');
  });

  it('rejects plaintext payment references and unbound automatic orders in PostgreSQL',async()=>{
    const f=await recurringFixture();
    const insert=(kind:string,input:unknown)=>database.client`insert into billing_orders(tenant_id,plan_version_id,requested_by,kind,amount_minor,currency,ai_credits,video_seconds,provider,merchant_id,test,input,input_hash,idempotency_key,correlation_id,renewal_consent_id,renewal_revision) select tenant_id,plan_version_id,requested_by,${kind},amount_minor,currency,ai_credits,video_seconds,provider,merchant_id,test,${JSON.stringify(input)},input_hash,${randomUUID()},correlation_id,renewal_consent_id,renewal_revision from billing_orders where id=${f.order.id}`;
    await expect(insert('START',{...f.order.input,paymentMethodId:'fixture-plaintext'})).rejects.toThrow('billing_order_no_plaintext_method');
    await expect(insert('RENEWAL',{mode:'RENEWAL',amountMinor:f.order.amountMinor,currency:'RUB',description:'Subscription AGENCY',receipt:f.order.input.receipt})).rejects.toThrow('Renewal order requires a bound method and paid term');
  });

  it('retains a January-31 anchor through a slightly late February renewal',async()=>{
    const f=await recurringFixture(new Date('2027-01-31T12:00:00.000Z'));f.due();const intent=await f.schedule(),id=intent!.orderId;
    vi.mocked(f.provider.create).mockResolvedValue({...f.paid,reference:{...f.paid.reference,internalId:id,externalId:id},observation:{...f.paid.observation,internalId:id,externalId:id}});
    const billing=new BillingRepository(database.db,f.clock),processor=new PaymentProcessor(f.tasks,billing,f.provider,f.merchant,f.vault,true);await processor.run(f.tenantId,id);
    const [term]=await database.client`select * from subscription_terms where order_id=${id}`;
    expect(new Date(term!.starts_at).toISOString()).toBe('2027-02-28T12:00:00.000Z');expect(new Date(term!.ends_at).toISOString()).toBe('2027-03-31T12:00:00.000Z');expect(term!.month_index).toBe(2);
  });

});
