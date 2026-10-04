import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { BillingRepository, createDatabase, RenewalRepository } from '../../packages/db/src/index';
import { CredentialVault, PaymentMethodService } from '../../packages/core/src/index';
import type { EncryptedCredential, PaymentResult } from '../../packages/types/src/index';
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('consent-bound encrypted payment methods', () => {
  if (url && !new URL(url).pathname.endsWith('_test')) throw new Error('Dedicated test database required');
  const database = createDatabase(url ?? 'postgresql://localhost/unused_test'), billing = new BillingRepository(database.db), renewal = new RenewalRepository(database.db);
  const vault = new CredentialVault(JSON.stringify({v1:randomBytes(32).toString('base64')}),'v1'), methods = new PaymentMethodService(billing,vault);
  afterAll(() => database.close());
  async function fixture() {
    const tenantId=randomUUID(),owner=randomUUID(),correlation=randomUUID(),planVersionId=randomUUID();
    await database.client`insert into users(id,email,password_hash,name,email_verified_at) values(${owner},${`method-${owner}@example.test`},'unusable','Owner',now())`;
    await database.client`insert into organizations(id,name) values(${tenantId},'Method fixture')`;
    await database.client`insert into organization_members(tenant_id,user_id,role) values(${tenantId},${owner},'OWNER')`;
    const [plan]=await database.client`update plans set enabled=true where code='START' returning id`;
    await database.client`insert into plan_versions(id,plan_id,version,amount_minor,currency,ai_credits,video_seconds) select ${planVersionId},${plan!.id},coalesce(max(version),0)+1,99900,'RUB',50,100 from plan_versions where plan_id=${plan!.id}`;
    const policy=await renewal.preview(owner,tenantId,planVersionId);
    const consent=await renewal.accept(owner,tenantId,{planVersionId,policyVersion:policy.policyVersion,textHash:policy.textHash,accepted:true,expectedRevision:0,idempotencyKey:randomUUID()},{ip:'192.0.2.1',userAgent:'fixture'},correlation);
    const input={returnUrl:'https://contentos.example/billing',receipt:{customerEmail:'fixture@example.test',vatCode:11,mode:'full_payment' as const,subject:'service' as const}};
    const merchant={provider:'yookassa' as const,merchantId:'100500',test:true};
    const reference={consentId:consent.consentId!,revision:consent.revision};
    const checkout=(key=randomUUID(),withConsent=true)=>billing.checkout(owner,tenantId,planVersionId,key,{...input,...(withConsent?{renewal:reference}:{})},merchant,correlation);
    const result=(orderId:string):PaymentResult=>({reference:{provider:'yookassa',externalId:randomUUID(),internalId:orderId,metadata:{}},observation:{...merchant,externalId:randomUUID(),internalId:orderId,amountMinor:99900,currency:'RUB',status:'SUCCEEDED',paid:true},confirmationUrl:null,savedPaymentMethodId:'fixture-saved-method',receiptStatus:'SUCCEEDED'});
    const cancel=()=>renewal.cancel(owner,tenantId,{expectedRevision:1,idempotencyKey:randomUUID()},correlation);
    return {tenantId,owner,correlation,planVersionId,policy,consent,input,merchant,reference,checkout,result,cancel};
  }
  it('requires active consent to request method saving and preserves checkout idempotency',async()=>{
    const f=await fixture(),key=randomUUID(),plain=await f.checkout(randomUUID(),false),order=await f.checkout(key);
    expect(plain.input.mode==='CHECKOUT'&&plain.input.saveMethod).toBe(false);expect(order.input.mode==='CHECKOUT'&&order.input.saveMethod).toBe(true);expect(order.renewalConsentId).toBe(f.consent.consentId);
    await f.cancel();await expect(f.checkout()).rejects.toThrow('CONSENT_REQUIRED');expect((await f.checkout(key)).id).toBe(order.id);
    await expect(billing.checkout(f.owner,f.tenantId,f.planVersionId,randomUUID(),{...f.input,renewal:{consentId:randomUUID(),revision:1}},f.merchant,f.correlation)).rejects.toThrow('CONSENT_REQUIRED');
  });
  it('stores only an encrypted method after paid settlement, once',async()=>{
    const f=await fixture(),order=await f.checkout(),result=f.result(order.id);
    await expect(methods.capture(f.tenantId,order.id,result)).rejects.toThrow('CONFLICT');
    await billing.settle(f.tenantId,order.id,result.observation);
    expect(await methods.capture(f.tenantId,order.id,result)).toEqual({saved:true});expect(await methods.capture(f.tenantId,order.id,result)).toEqual({saved:true});
    const rows=await database.client`select * from billing_payment_methods where tenant_id=${f.tenantId}`;expect(rows).toHaveLength(1);expect(JSON.stringify(rows)).not.toContain('fixture-saved-method');
    const scope={kind:'PAYMENT_METHOD' as const,tenantId:f.tenantId,methodId:order.id,provider:'yookassa',merchantId:'100500',test:true};
    expect(vault.decrypt(rows[0]!.credential as EncryptedCredential,scope)).toBe('fixture-saved-method');
    await expect(methods.capture(f.tenantId,order.id,{...result,observation:{...result.observation,externalId:randomUUID()}})).rejects.toThrow('CONFLICT');
  });
  it('cancellation wins against late/concurrent saving and erases usable ciphertext',async()=>{
    const f=await fixture(),order=await f.checkout(),result=f.result(order.id);await billing.settle(f.tenantId,order.id,result.observation);
    await Promise.all([methods.capture(f.tenantId,order.id,result),f.cancel()]);
    expect(await methods.capture(f.tenantId,order.id,result)).toEqual({saved:false});
    const rows=await database.client`select credential,revoked_at from billing_payment_methods where tenant_id=${f.tenantId}`;
    for(const row of rows){expect(row.credential).toBeNull();expect(row.revoked_at).not.toBeNull();}
    expect((await billing.overview(f.owner,f.tenantId)).status).toBe('ACTIVE');
  });
  it('replacing permission revokes the old method and rejects late reattachment',async()=>{
    const f=await fixture(),order=await f.checkout(),result=f.result(order.id);await billing.settle(f.tenantId,order.id,result.observation);await methods.capture(f.tenantId,order.id,result);
    await renewal.accept(f.owner,f.tenantId,{planVersionId:f.planVersionId,policyVersion:f.policy.policyVersion,textHash:f.policy.textHash,accepted:true,expectedRevision:1,idempotencyKey:randomUUID()},{ip:'192.0.2.1',userAgent:'fixture'},f.correlation);
    expect(await methods.capture(f.tenantId,order.id,result)).toEqual({saved:false});
    const [row]=await database.client`select * from billing_payment_methods where id=${order.id}`;expect(row!.credential).toBeNull();
    await expect(database.client`update billing_payment_methods set revoked_at=null,credential='{}' where id=${order.id}`).rejects.toThrow();
  });
  it('does not attach without consent, confirmed saved method, owner rights or vault configuration',async()=>{
    const f=await fixture(),plain=await f.checkout(randomUUID(),false),order=await f.checkout(),plainResult=f.result(plain.id),result=f.result(order.id);
    await billing.settle(f.tenantId,plain.id,plainResult.observation);expect(await methods.capture(f.tenantId,plain.id,plainResult)).toEqual({saved:false});
    expect(await methods.capture(f.tenantId,order.id,{...result,savedPaymentMethodId:null})).toEqual({saved:false});
    await expect(new PaymentMethodService(billing,null).capture(f.tenantId,order.id,result)).rejects.toThrow('CONFIGURATION_REQUIRED');
    await billing.settle(f.tenantId,order.id,result.observation);await database.client`update organization_members set role='VIEWER' where tenant_id=${f.tenantId} and user_id=${f.owner}`;
    expect(await methods.capture(f.tenantId,order.id,result)).toEqual({saved:false});
  });
});
