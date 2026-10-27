import {test,expect,type Route} from '@playwright/test';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {createDatabase} from '../../packages/db/src/index';
const url=process.env.TEST_DATABASE_URL;
if(!url||!new URL(url).pathname.endsWith('_test'))throw new Error('Dedicated test database required');
const database=createDatabase(url);test.afterAll(()=>database.close());
test('searches tenant data with pagination, literal text, empty/error states and mobile layout',async({page,context,baseURL},testInfo)=>{
  const user=randomUUID(),tenant=randomUUID(),otherTenant=randomUUID(),token=randomBytes(32).toString('base64url');
  await database.client`insert into users(id,email,name,password_hash,email_verified_at) values(${user},${`${user}@example.test`},'Search fixture','unusable',now())`;
  await database.client`insert into organizations(id,name) values(${tenant},'Search fixture')`;
  await database.client`insert into workspaces(id,tenant_id,name) values(${tenant},${tenant},'Workspace')`;
  await database.client`insert into organization_members(tenant_id,user_id,role) values(${tenant},${user},'VIEWER')`;
  await database.client`insert into organizations(id,name) values(${otherTenant},'Other search fixture')`;
  await database.client`insert into workspaces(id,tenant_id,name) values(${otherTenant},${otherTenant},'Other workspace')`;
  await database.client`insert into organization_members(tenant_id,user_id,role) values(${otherTenant},${user},'VIEWER')`;
  await database.client`insert into sessions(user_id,token_hash,expires_at) values(${user},${createHash('sha256').update(token).digest('hex')},now()+interval '1 hour')`;
  await database.client`insert into brands(tenant_id,workspace_id,name) select ${tenant},${tenant},'Поиск 100%_ тест '||n from generate_series(1,31) n`;
  try{
    await context.addCookies([{name:'contentos_session',value:token,url:baseURL!,httpOnly:true,sameSite:'Lax'}]);
    await page.goto(`/dashboard?organization=${tenant}`);
    const panel=page.getByRole('region',{name:'Поиск по организации'});
    await panel.getByLabel('Поисковый запрос').fill('100%_');await panel.getByRole('button',{name:'Найти',exact:true}).click();
    await expect(panel.locator('li')).toHaveCount(30);
    const firstTitles=await panel.locator('li h3').allTextContents();
    await expect(panel.getByText('Страница 1',{exact:true})).toBeVisible();
    await panel.getByRole('button',{name:'Следующая страница результатов'}).click();await expect(panel.locator('li')).toHaveCount(1);
    await expect(panel.getByText('Страница 2',{exact:true})).toBeVisible();
    // A failed back request must not commit its target cursor or discard the
    // currently visible page. Retrying fetches again under current authorization.
    await page.route(`**/organizations/${tenant}/search?*`,route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{message:'Повторите переход'}})}),{times:1});
    await panel.getByRole('button',{name:'Предыдущая страница результатов'}).click();
    await expect(panel.getByRole('alert')).toHaveText('Повторите переход');
    await expect(panel.getByText('Страница 2',{exact:true})).toBeVisible();await expect(panel.locator('li')).toHaveCount(1);
    await panel.getByRole('button',{name:'Предыдущая страница результатов'}).click();await expect(panel.locator('li')).toHaveCount(30);
    expect(await panel.locator('li h3').allTextContents()).toEqual(firstTitles);
    await panel.getByRole('button',{name:'Следующая страница результатов'}).click();await expect(panel.locator('li')).toHaveCount(1);
    await panel.getByRole('button',{name:'Первая страница результатов',exact:true}).click();await expect(panel.locator('li')).toHaveCount(30);
    // Supersede a pending next-page request. Its late response cannot revive the
    // previous query's items or advance the newly submitted query's page number.
    let capture!:(route:Route)=>void;
    const captured=new Promise<Route>(resolve=>{capture=resolve;});
    await page.route(`**/organizations/${tenant}/search?*`,route=>{capture(route);},{times:1});
    await panel.getByRole('button',{name:'Следующая страница результатов'}).click();
    const held=await captured;
    await expect(panel.getByRole('button',{name:'Следующая страница результатов'})).toBeDisabled();
    await panel.getByLabel('Поисковый запрос').fill('нет совпадения');await panel.getByRole('button',{name:'Найти',exact:true}).click();await expect(panel.getByText('Совпадений не найдено.')).toBeVisible();
    await held.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:{items:[{id:randomUUID(),kind:'BRAND',brandId:randomUUID(),brandName:'Stale fixture',title:'Устаревший ответ',excerpt:''}],next:null}})});
    await expect(panel.getByText('Устаревший ответ')).toHaveCount(0);await expect(panel.getByText('Страница 1',{exact:true})).toBeVisible();
    await expect(panel.getByRole('button',{name:'Предыдущая страница результатов'})).toHaveCount(0);
    await page.route(`**/organizations/${tenant}/search?*`,route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{message:'Поиск временно недоступен'}})}),{times:1});
    await panel.getByRole('button',{name:'Найти',exact:true}).click();await expect(panel.getByRole('alert')).toHaveText('Поиск временно недоступен');
    await panel.getByLabel('Поисковый запрос').fill('100%_');await panel.getByRole('button',{name:'Найти',exact:true}).click();await expect(panel.locator('li')).toHaveCount(30);
    await panel.getByRole('button',{name:'Следующая страница результатов'}).click();await expect(panel.locator('li')).toHaveCount(1);
    await panel.getByLabel('Тип результата').selectOption('SCRIPT');await panel.getByRole('button',{name:'Найти',exact:true}).click();
    await expect(panel.getByText('Совпадений не найдено.')).toBeVisible();await expect(panel.getByText('Страница 1',{exact:true})).toBeVisible();
    await panel.getByLabel('Тип результата').selectOption('');await panel.getByRole('button',{name:'Найти',exact:true}).click();await expect(panel.locator('li')).toHaveCount(30);
    const response=await page.request.get(`/api/v1/organizations/${tenant}/search?q=100%25_`);expect(response.status()).toBe(200);expect(response.headers()['cache-control']).toBe('no-store');
    expect((await page.request.get(`/api/v1/organizations/${randomUUID()}/search?q=100%25_`)).status()).toBe(404);
    await panel.getByRole('button',{name:'Следующая страница результатов'}).click();await expect(panel.locator('li')).toHaveCount(1);
    await page.setViewportSize({width:390,height:844});await panel.scrollIntoViewIfNeeded();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:testInfo.outputPath('search-mobile.png')});
    await page.getByLabel('Организация',{exact:true}).selectOption(otherTenant);
    await expect(panel.getByLabel('Поисковый запрос')).toHaveValue('');await expect(panel.locator('li')).toHaveCount(0);
    await expect(panel.getByRole('navigation',{name:'Страницы результатов поиска'})).toHaveCount(0);
  }finally{await database.client`delete from sessions where user_id=${user}`;}
});
