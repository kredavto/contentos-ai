import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { BillingRepository, PaymentTaskRepository } from '../../packages/db/src/index';
import { isolatedTestDatabase } from '../helpers/isolated-database';
const url=process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('confirmed monthly plan changes',()=>{
  const database=isolatedTestDatabase(url),billing=new BillingRepository(database.db),tasks=new PaymentTaskRepository(database.db);
  const merchant={provider:'yookassa' as const,merchantId:'100500',test:true};
  const input={returnUrl:'https://contentos.example/billing',receipt:{customerEmail:'plan@example.test',vatCode:11,mode:'full_payment' as const,subject:'service' as const}};
  const quotes:Record<string,string>={};
  beforeAll(async()=>{
    for(const [code,amount,credits] of [['START',10000,10],['CREATOR',20000,20],['EXPERT',30000,30]] as const){
      const [plan]=await database.client`update plans set enabled=true where code=${code} returning id`;
      const id=randomUUID();quotes[code]=id;await database.client`insert into plan_versions(id,plan_id,version,amount_minor,ai_credits,video_seconds) values(${id},${plan!.id},1,${amount},${credits},${credits*10})`;
    }
  },60000);

  async function fixture(code='CREATOR'){
    const tenantId=randomUUID(),owner=randomUUID();
    await database.client`insert into users(id,email,password_hash,name,email_verified_at) values(${owner},${`plan-${owner}@example.test`},'unusable','Owner',now())`;
    await database.client`insert into organizations(id,name) values(${tenantId},'Plan fixture')`;
    await database.client`insert into organization_members(tenant_id,user_id,role) values(${tenantId},${owner},'OWNER')`;
    const buy=(target:string,expectedTermId?:string,key=randomUUID())=>billing.checkout(owner,tenantId,quotes[target]!,key,{...input,...(expectedTermId?{expectedTermId}:{})},merchant,randomUUID());
    const settle=(order:Awaited<ReturnType<typeof buy>>)=>billing.settle(tenantId,order.id,{...merchant,externalId:randomUUID(),internalId:order.id,amountMinor:order.amountMinor,currency:'RUB',status:'SUCCEEDED',paid:true});
    await settle(await buy(code));const overview=await billing.overview(owner,tenantId);
    return {tenantId,owner,buy,settle,term:overview.current!};
  }
  it.each([['EXPERT','UPGRADE'],['START','DOWNGRADE']] as const)('confirms %s for the next paid month without replacing the current term',async(target,direction)=>{
    const f=await fixture(),preview=await billing.purchasePreview(f.owner,f.tenantId,quotes[target]!);expect(preview.direction).toBe(direction);expect(preview.expectedTermId).toBe(f.term.id);expect(preview.effectiveAt).toEqual(f.term.endsAt);
    await expect(f.buy(target)).rejects.toThrow('CONFLICT');
    const key=randomUUID(),order=await f.buy(target,preview.expectedTermId!,key);expect(order.kind).toBe(direction);expect(order.changeFromTermId).toBe(f.term.id);expect((await f.buy(target,preview.expectedTermId!,key)).id).toBe(order.id);
    await f.settle(order);const after=await billing.overview(f.owner,f.tenantId);expect(after.current!.id).toBe(f.term.id);expect(after.current!.planCode).toBe('CREATOR');expect(after.upcoming).toHaveLength(1);expect(after.upcoming[0]!.startsAt).toEqual(f.term.endsAt);expect(after.upcoming[0]!.planCode).toBe(target);
    expect((await billing.purchasePreview(f.owner,f.tenantId,quotes.CREATOR!)).expectedTermId).toBe(after.upcoming[0]!.id);
  });
  it('rejects a stale preview and cancels unsent work after another payment extends the period',async()=>{
    const f=await fixture(),queued=await f.buy('EXPERT',f.term.id);await f.settle(await f.buy('CREATOR'));
    await expect(f.buy('START',f.term.id)).rejects.toThrow('CONFLICT');
    const task=await tasks.claim(f.tenantId,queued.id);expect(await tasks.prepare(f.tenantId,queued.id,task!.leaseToken!,merchant)).toBeNull();
    expect((await billing.orderStatus(f.owner,f.tenantId,queued.id)).status).toBe('CANCELED');
  });
  it('keeps an already sent payment reconcilable and appends its paid month once',async()=>{
    const f=await fixture(),queued=await f.buy('EXPERT',f.term.id),task=await tasks.claim(f.tenantId,queued.id);await tasks.prepare(f.tenantId,queued.id,task!.leaseToken!,merchant);
    await f.settle(await f.buy('CREATOR'));await f.settle(queued);
    const after=await billing.overview(f.owner,f.tenantId);expect(after.upcoming).toHaveLength(2);expect(after.upcoming[1]!.planCode).toBe('EXPERT');expect(after.upcoming[1]!.startsAt).toEqual(after.upcoming[0]!.endsAt);
  });
  it('guards direction and tenant binding in PostgreSQL and blocks unauthorized previews',async()=>{
    const f=await fixture(),other=await fixture();await expect(billing.purchasePreview(other.owner,f.tenantId,quotes.EXPERT!)).rejects.toThrow('NOT_FOUND');
    await expect(f.buy('EXPERT',other.term.id)).rejects.toThrow('CONFLICT');
    const order=await f.buy('EXPERT',f.term.id);
    await expect(database.client`insert into billing_orders(tenant_id,plan_version_id,requested_by,kind,change_from_term_id,amount_minor,currency,ai_credits,video_seconds,provider,merchant_id,test,input,input_hash,idempotency_key,correlation_id) select tenant_id,plan_version_id,requested_by,'DOWNGRADE',change_from_term_id,amount_minor,currency,ai_credits,video_seconds,provider,merchant_id,test,input,input_hash,${randomUUID()},correlation_id from billing_orders where id=${order.id}`).rejects.toThrow('Plan change must match');
    await database.client`update organization_members set role='EDITOR' where tenant_id=${f.tenantId}`;await expect(billing.purchasePreview(f.owner,f.tenantId,quotes.START!)).rejects.toThrow('NOT_AUTHORIZED');
  });
});
