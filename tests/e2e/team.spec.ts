import { test, expect } from '@playwright/test';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { createDatabase } from '../../packages/db/src/index';
const url=process.env.TEST_DATABASE_URL;
if(!url||!new URL(url).pathname.endsWith('_test'))throw new Error('Dedicated test database required');
const database=createDatabase(url);
test.afterAll(()=>database.close());
test('team invitation, role update and explicit ownership transfer',async({page,context,browser,baseURL},testInfo)=>{
  const tenant=randomUUID(),owner=randomUUID(),guest=randomUUID(),guestEmail=`guest-${guest}@example.test`;
  async function session(userId:string,email:string){const token=randomBytes(32).toString('base64url');await database.client`insert into users(id,email,password_hash,name,email_verified_at) values(${userId},${email},'unusable',${userId===owner?'Владелец команды':'Участник команды'},now())`;await database.client`insert into sessions(user_id,token_hash,expires_at) values(${userId},${createHash('sha256').update(token).digest('hex')},now()+interval '1 hour')`;return token;}
  const ownerToken=await session(owner,`owner-${owner}@example.test`),guestToken=await session(guest,guestEmail);
  const existingTenant=randomUUID();await database.client`insert into organizations(id,name) values(${existingTenant},'Existing guest organization')`;await database.client`insert into organization_members(tenant_id,user_id,role) values(${existingTenant},${guest},'OWNER')`;
  await database.client`insert into organizations(id,name) values(${tenant},'Team browser')`;await database.client`insert into organization_members(tenant_id,user_id,role) values(${tenant},${owner},'OWNER')`;
  await context.addCookies([{name:'contentos_session',value:ownerToken,url:baseURL!,httpOnly:true,sameSite:'Lax'}]);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`/team?organization=${tenant}`);await expect(page.getByRole('heading',{name:'Владелец команды',exact:true})).toBeVisible();
  expect((await page.request.post(`/api/organizations/${tenant}/team/invite`,{data:{email:guestEmail,role:'VIEWER',idempotencyKey:randomUUID()}})).status()).toBe(403);
  await page.getByLabel('Email',{exact:true}).fill(guestEmail);await page.getByRole('button',{name:'Создать приглашение'}).click();const link=page.getByLabel('Ссылка приглашения');await expect(link).toBeVisible();const invitation=await link.inputValue();expect(new URL(invitation).search).toBe('');
  const guestContext=await browser.newContext({baseURL});try{
    await guestContext.addCookies([{name:'contentos_session',value:guestToken,url:baseURL!,httpOnly:true,sameSite:'Lax'}]);const guestPage=await guestContext.newPage();await guestPage.goto(invitation);await guestPage.getByRole('button',{name:'Принять приглашение'}).click();await expect(guestPage.getByText('Вы присоединились к организации.')).toBeVisible();expect(guestPage.url()).not.toContain('#');await guestPage.getByRole('link',{name:'Открыть рабочее пространство'}).click();await expect(guestPage.getByLabel('Организация',{exact:true})).toHaveValue(tenant);
    await page.getByRole('button',{name:'Обновить',exact:true}).click();const card=page.getByRole('article').filter({has:page.getByRole('heading',{name:'Участник команды',exact:true})});await expect(card).toBeVisible();
    await card.getByRole('combobox').selectOption('EDITOR');await card.getByRole('button',{name:'Сохранить роль'}).click();await expect(page.getByRole('button',{name:'Обновить',exact:true})).toBeEnabled();await expect(card.locator('p').filter({hasText:/^Редактор$/})).toBeVisible();
    await page.screenshot({path:testInfo.outputPath('team-desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:testInfo.outputPath('team-mobile.png'),fullPage:true});
    page.once('dialog',dialog=>dialog.accept());await card.getByRole('button',{name:'Передать владение'}).click();await expect(page.getByRole('button',{name:'Передать владение'})).toHaveCount(0);
    expect((await page.request.get(`/api/organizations/${tenant}/billing`)).status()).toBe(403);
    await guestPage.goto(`/team?organization=${tenant}`);await expect(guestPage.getByRole('button',{name:'Передать владение'})).toBeVisible();
    const owners=await database.client`select user_id from organization_members where tenant_id=${tenant} and role='OWNER'`;expect(owners.map(row=>row.user_id)).toEqual([guest]);
  }finally{await guestContext.close();}
  expect(errors).toEqual([]);
});
