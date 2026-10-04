import { test, expect } from '@playwright/test';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { createDatabase } from '../../packages/db/src/index';
const url=process.env.TEST_DATABASE_URL;
if(!url||!new URL(url).pathname.endsWith('_test'))throw new Error('Dedicated test database required');
const database=createDatabase(url);
test.afterAll(()=>database.close());
async function fixture(){
  const owner=randomUUID(),tenantId=randomUUID(),token=randomBytes(32).toString('base64url');
  await database.client`insert into users(id,email,password_hash,name,email_verified_at) values(${owner},${`billing-browser-${owner}@example.test`},'unusable','Billing browser',now())`;
  await database.client`insert into organizations(id,name) values(${tenantId},'Billing browser fixture')`;
  await database.client`insert into organization_members(tenant_id,user_id,role) values(${tenantId},${owner},'OWNER')`;
  await database.client`insert into sessions(user_id,token_hash,expires_at) values(${owner},${createHash('sha256').update(token).digest('hex')},now()+interval '1 hour')`;
  return {owner,tenantId,token};
}
test('owner sees disabled billing and tenant/CSRF boundaries remain enforced',async({page,context,baseURL},testInfo)=>{
  const f=await fixture();await context.addCookies([{name:'contentos_session',value:f.token,url:baseURL!,httpOnly:true,sameSite:'Lax'}]);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`/billing?organization=${f.tenantId}`);
  await expect(page.getByRole('heading',{name:'Биллинг',exact:true})).toBeVisible();await expect(page.getByText('Приём платежей пока не подключён.',{exact:false})).toBeVisible();
  const result=await page.request.get(`/api/organizations/${f.tenantId}/billing`);expect(result.status()).toBe(200);
  const csrf=await page.request.post(`/api/organizations/${f.tenantId}/billing/checkout`,{data:{planVersionId:randomUUID(),idempotencyKey:randomUUID()}});expect(csrf.status()).toBe(403);
  await page.screenshot({path:testInfo.outputPath('billing-disabled-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('billing-disabled-mobile.png'),fullPage:true});expect(errors).toEqual([]);
  await database.client`update organization_members set role='EDITOR' where tenant_id=${f.tenantId}`;
  expect((await page.request.get(`/api/organizations/${f.tenantId}/billing`)).status()).toBe(403);
});
test('explicit UI fixtures cover checkout retry, confirmation and paid state',async({page,context,baseURL},testInfo)=>{
  const f=await fixture(),planVersionId=randomUUID(),orderId=randomUUID();await context.addCookies([{name:'contentos_session',value:f.token,url:baseURL!,httpOnly:true,sameSite:'Lax'}]);
  const base=`/api/organizations/${f.tenantId}/billing`;let checkoutCalls=0,status='QUEUED';const keys:string[]=[];
  const order=()=>({id:orderId,planVersionId,amountMinor:199900,currency:'RUB',createdAt:new Date().toISOString(),status,confirmationUrl:status==='WAITING'?'https://yoomoney.ru/checkout/fixture':null,errorCode:null});
  await page.route(`**${base}`,route=>route.fulfill({json:{data:{checkoutStatus:'READY',plans:[{planVersionId,code:'CREATOR',name:'Автор',amountMinor:199900,currency:'RUB',aiCredits:100,videoSeconds:300}],subscription:{status:status==='PAID'?'ACTIVE':'INACTIVE',current:status==='PAID'?{endsAt:'2027-01-01T00:00:00Z'}:null,orders:[]},renewal:{revision:0,active:null}}}}));
  await page.route(`**${base}/checkout`,route=>{checkoutCalls++;keys.push(route.request().postDataJSON().idempotencyKey);return checkoutCalls===1?route.fulfill({status:503,json:{error:{message:'Тестовый временный сбой'}}}):route.fulfill({status:202,json:{data:order()}});});
  await page.route(`**${base}/orders/${orderId}`,route=>route.fulfill({json:{data:order()}}));
  await page.goto(`/billing?organization=${f.tenantId}`);await page.getByRole('button',{name:'Оплатить месяц'}).click();await expect(page.getByRole('alert').filter({hasText:'Тестовый временный сбой'})).toContainText('Тестовый временный сбой');
  await page.getByRole('button',{name:'Оплатить месяц'}).click();expect(keys[0]).toBe(keys[1]);await expect(page.getByRole('heading',{name:'Готовим оплату'})).toBeVisible();
  status='WAITING';await page.getByRole('button',{name:'Обновить статус'}).click();await expect(page.getByRole('link',{name:'Перейти к оплате'})).toHaveAttribute('href','https://yoomoney.ru/checkout/fixture');
  await expect(page.getByRole('button',{name:'Оплатить месяц'})).toBeDisabled();
  status='PAID';await page.getByRole('button',{name:'Обновить статус'}).click();await expect(page.getByRole('heading',{name:'Оплачено',exact:true})).toBeVisible();await expect(page.getByRole('link',{name:'Перейти к оплате'})).toHaveCount(0);
  await page.screenshot({path:testInfo.outputPath('billing-paid-desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:testInfo.outputPath('billing-paid-mobile.png'),fullPage:true});
  await page.getByRole('button',{name:'Оплатить месяц'}).click();expect(keys[2]).not.toBe(keys[1]);
});
