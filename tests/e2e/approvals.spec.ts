import {test,expect} from '@playwright/test';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {createDatabase,BrandRepository} from '../../packages/db/src/index';
import {BrandService} from '../../packages/core/src/brands';
const url=process.env.TEST_DATABASE_URL;
if(!url||!new URL(url).pathname.endsWith('_test'))throw new Error('Dedicated test database required');
const database=createDatabase(url);test.afterAll(()=>database.close());
test('requests a specific script version and lets only its assignee approve it',async({page,context,baseURL},testInfo)=>{
  const owner=randomUUID(),reviewer=randomUUID(),script=randomUUID(),item=randomUUID(),correlation=randomUUID();
  const ownerToken=randomBytes(32).toString('base64url'),reviewerToken=randomBytes(32).toString('base64url');
  for(const [id,token,name] of [[owner,ownerToken,'Writer fixture'],[reviewer,reviewerToken,'Reviewer fixture']] as const){await database.client`insert into users(id,email,name,password_hash,email_verified_at) values(${id},${`${id}@example.test`},${name},'unusable',now())`;await database.client`insert into sessions(user_id,token_hash,expires_at) values(${id},${createHash('sha256').update(token).digest('hex')},now()+interval '1 hour')`;}
  const brands=new BrandService(new BrandRepository(database.db)),tenant=(await brands.createOrganization(owner,{name:'Approval browser'},correlation)).id,workspace=(await brands.overview(owner,tenant)).workspaces[0]!;
  const brand=(await brands.createBrand(owner,tenant,{workspaceId:workspace.id,name:'Approval brand'},correlation)).id;
  await database.client`insert into organization_members(tenant_id,user_id,role) values(${tenant},${reviewer},'CLIENT_APPROVER')`;
  await database.client`insert into content_items(id,tenant_id,brand_id,title,type) values(${item},${tenant},${brand},'Browser script','SHORT_VIDEO')`;
  await database.client`insert into scripts(id,tenant_id,brand_id,content_item_id,current_version,platform,duration) values(${script},${tenant},${brand},${item},1,'YOUTUBE',30)`;
  await database.client`insert into script_versions(tenant_id,script_id,version,content,created_by) values(${tenant},${script},1,'{"hook":"Review hook","context":"Context","core":"Exact reviewed text","proof":"Proof","cta":"CTA","factCheckNotes":[]}',${owner})`;
  async function login(token:string){await context.clearCookies();await context.addCookies([{name:'contentos_session',value:token,url:baseURL!,httpOnly:true,sameSite:'Lax'}]);}
  try{
    await login(ownerToken);await page.goto(`/brands/${brand}/content?organization=${tenant}&tab=scripts`);await page.getByLabel('Сценарий',{exact:true}).selectOption(script);
    const form=page.getByRole('region',{name:'Запрос согласования сценария'});await form.getByLabel('Согласующий',{exact:true}).selectOption(reviewer);await form.getByLabel('Комментарий согласующему').fill('Проверьте доказательства');await form.getByRole('button',{name:'Отправить на согласование'}).click();await expect(form.getByRole('status')).toHaveText('Запрос сохранён.');
    const request=(await database.client`select id from approval_requests where script_id=${script}`)[0]!;
    const endpoint=`/api/organizations/${tenant}/approvals/${request.id}`;
    expect((await page.request.post(endpoint,{headers:{origin:baseURL!},data:{status:'APPROVED'}})).status()).toBe(403);
    await login(reviewerToken);await page.goto(`/approvals?organization=${tenant}`);await expect(page.getByRole('heading',{name:'Browser script · v1'})).toBeVisible();
    await page.getByText('Сценарий на согласовании',{exact:true}).click();await expect(page.getByText('Exact reviewed text',{exact:false})).toBeVisible();
    expect((await page.request.post(endpoint,{data:{status:'APPROVED'}})).status()).toBe(403);
    await page.getByLabel('Комментарий к решению').fill('Версия проверена');await page.getByRole('button',{name:'Одобрить версию'}).click();await expect(page.getByText('Одобрен',{exact:true})).toBeVisible();
    const response=await page.request.get(`/api/organizations/${tenant}/approvals`);expect(response.headers()['cache-control']).toBe('no-store');expect(JSON.stringify(await response.json())).not.toMatch(/inputHash|idempotencyKey/);
    expect((await database.client`select approved_version,approved_by from scripts where id=${script}`)[0]).toEqual({approved_version:1,approved_by:reviewer});
    await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:testInfo.outputPath('approvals-mobile.png')});
  }finally{await database.client`delete from sessions where user_id in (${owner},${reviewer})`;}
});
