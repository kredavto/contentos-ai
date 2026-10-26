import {test,expect} from '@playwright/test';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {createDatabase} from '../../packages/db/src/index';
const url=process.env.TEST_DATABASE_URL;
if(!url||!new URL(url).pathname.endsWith('_test'))throw new Error('Dedicated test database required');
const database=createDatabase(url);test.afterAll(()=>database.close());
test('operator manages scoped rollout without granting tenant roles or bypassing source validation',async({page,context,browser,baseURL},testInfo)=>{
 const actor=randomUUID(),owner=randomUUID(),viewer=randomUUID(),tenant=randomUUID(),tokens=new Map<string,string>();
 for(const id of [actor,owner,viewer]){const token=randomBytes(32).toString('base64url');tokens.set(id,token);await database.client`insert into users(id,email,name,password_hash,email_verified_at) values(${id},${id+'@example.test'},'Feature browser fixture','unusable',now())`;await database.client`insert into sessions(user_id,token_hash,expires_at) values(${id},${createHash('sha256').update(token).digest('hex')},now()+interval '1 hour')`;}
 const workspace=randomUUID(),brand=randomUUID();await database.client`insert into organizations(id,name) values(${tenant},'Feature browser tenant')`;await database.client`insert into organization_members(tenant_id,user_id,role) values(${tenant},${owner},'OWNER'),(${tenant},${viewer},'VIEWER')`;await database.client`insert into workspaces(id,tenant_id,name) values(${workspace},${tenant},'Feature fixture')`;await database.client`insert into brands(id,tenant_id,workspace_id,name) values(${brand},${tenant},${workspace},'Feature fixture')`;
 await database.client`insert into platform_operators(user_id,role) values(${actor},'SUPPORT')`;
 const ownerContext=await browser.newContext({baseURL}),viewerContext=await browser.newContext({baseURL});
 const cookie=(id:string)=>({name:'contentos_session',value:tokens.get(id)!,url:baseURL!,httpOnly:true,sameSite:'Lax' as const});
 await context.addCookies([cookie(actor)]);await ownerContext.addCookies([cookie(owner)]);await viewerContext.addCookies([cookie(viewer)]);
 const body=()=>({name:'Must validate source',sourceAssetId:randomUUID(),subjectId:randomUUID(),likenessType:'OWN_LIKENESS',idempotencyKey:randomUUID()}),path=`/api/v1/organizations/${tenant}/brands/${brand}/avatars`,headers={origin:baseURL!};
 try{
  await page.goto('/admin');const panel=page.getByRole('region',{name:'Управление доступностью функций',exact:true});await panel.getByLabel('Функция',{exact:true}).selectOption('avatar_generation');await panel.getByLabel('Область правила',{exact:true}).selectOption('PLAN');await expect(panel.getByLabel('Тариф для правила',{exact:true})).toBeEnabled();await panel.getByLabel('Тариф для правила',{exact:true}).selectOption({label:'FREE (FREE)'});await panel.getByRole('button',{name:'Прочитать правило',exact:true}).click();await expect(panel.getByRole('status')).toContainText('Ревизия: 0');await panel.getByLabel('Область правила',{exact:true}).selectOption('ORGANIZATION');await panel.getByLabel('ID области правила',{exact:true}).fill(tenant);await panel.getByRole('button',{name:'Прочитать правило',exact:true}).click();
  await expect(panel.getByRole('status')).toContainText('Ревизия: 0');await expect(panel.getByRole('button',{name:'Сохранить правило',exact:true})).toBeDisabled();
  expect((await page.request.post('/api/v1/admin/feature-policy',{headers,data:{feature:'avatar_generation',scope:'ORGANIZATION',targetId:tenant,mode:'DISABLED',expectedRevision:0,ticket:'BROWSER-FLAG',idempotencyKey:randomUUID()}})).status()).toBe(403);
  await database.client`update platform_operators set role='ADMIN' where user_id=${actor}`;await panel.getByRole('button',{name:'Прочитать правило',exact:true}).click();await expect(panel.getByLabel('Состояние функции',{exact:true})).toBeEnabled();
  await panel.getByLabel('Состояние функции',{exact:true}).selectOption('DISABLED');await panel.getByLabel('Обращение для изменения функции',{exact:true}).fill('BROWSER-FLAG');await panel.getByRole('button',{name:'Сохранить правило',exact:true}).click();await expect(panel.getByRole('status')).toContainText('Ревизия: 1');
  const effective=await ownerContext.request.get(`/api/v1/organizations/${tenant}/features`);expect(effective.headers()['cache-control']).toBe('no-store');expect((await effective.json()).data.features).toContainEqual({feature:'avatar_generation',enabled:false,source:'ORGANIZATION'});
  expect((await ownerContext.request.post(path,{headers,data:body()})).status()).toBe(403);
  await panel.getByLabel('Состояние функции',{exact:true}).selectOption('INHERIT');await panel.getByRole('button',{name:'Сохранить правило',exact:true}).click();await expect(panel.getByRole('status')).toContainText('Ревизия: 2');
  expect((await ownerContext.request.post(path,{headers,data:body()})).status()).toBe(404);expect((await viewerContext.request.post(path,{headers,data:body()})).status()).toBe(403);
  await expect(panel.getByRole('heading',{name:'История правила',exact:true})).toBeVisible();expect(await database.client`select c.id from feature_policy_changes c join feature_policies p on p.id=c.policy_id where p.tenant_id=${tenant}`).toHaveLength(2);
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await panel.screenshot({path:testInfo.outputPath('feature-policy-mobile.png')});
 }finally{await ownerContext.close();await viewerContext.close();await database.client`update platform_operators set revoked_at=now() where user_id=${actor}`;await database.client`delete from sessions where user_id in (${actor},${owner},${viewer})`;}
});
