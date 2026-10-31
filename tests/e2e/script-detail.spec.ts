import {test,expect} from '@playwright/test';
import {randomBytes,createHash} from 'node:crypto';
import {createDatabase} from '../../packages/db/src/index';
import {scriptDetailFixture} from '../helpers/script-detail-fixture';
const url=process.env.TEST_DATABASE_URL;
if(!url||!new URL(url).pathname.endsWith('_test'))throw new Error('Dedicated test database required');
const database=createDatabase(url);test.afterAll(()=>database.close());
test('opens the exact old script read-only from search with scoped reload and mobile layout',async({page,context,baseURL},testInfo)=>{
  const f=await scriptDetailFixture(database.client),token=randomBytes(32).toString('base64url');
  await database.client`insert into sessions(user_id,token_hash,expires_at) values(${f.user},${createHash('sha256').update(token).digest('hex')},now()+interval '1 hour')`;
  const detail=`/brands/${f.brand}/scripts/${f.script}?organization=${f.tenant}`;
  try{
    await context.addCookies([{name:'contentos_session',value:token,url:baseURL!,httpOnly:true,sameSite:'Lax'}]);
    await page.goto(`/dashboard?organization=${f.tenant}`);
    const search=page.getByRole('region',{name:'Поиск по организации'});
    await search.getByLabel('Тип результата').selectOption('SCRIPT');await search.getByLabel('Поисковый запрос').fill(f.title);await search.getByRole('button',{name:'Найти',exact:true}).click();
    await expect(search.locator('li')).toHaveCount(1);const link=search.getByRole('link',{name:'Открыть сценарий'});await expect(link).toHaveAttribute('href',detail);await link.click();
    await expect(page).toHaveURL(new RegExp(`/scripts/${f.script}\\?organization=${f.tenant}$`));
    await expect(page.getByRole('heading',{level:1})).toHaveText(f.title);
    const text=page.getByRole('article',{name:'Текст сценария'});await expect(text).toContainText(f.current.hook);await expect(text).not.toContainText('Historical hook');
    await expect(page.getByText('Текущая версия не одобрена',{exact:true})).toBeVisible();
    await expect(page.getByRole('main')).toHaveCount(1);await expect(page.locator('main textarea,main input,main form,main button')).toHaveCount(0);
    await expect(text.locator('script,img')).toHaveCount(0);await expect(page.getByRole('region',{name:'Проверка фактов'}).locator('img')).toHaveCount(0);
    await page.reload();await expect(page.getByRole('heading',{level:1})).toHaveText(f.title);await expect(text).toContainText(f.current.core);
    await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:testInfo.outputPath('script-detail-mobile.png'),fullPage:true});
    for(const wrong of [`/brands/${f.otherBrand}/scripts/${f.script}?organization=${f.tenant}`,`/brands/${f.foreign}/scripts/${f.script}?organization=${f.foreign}`,`${detail}&organization=${f.tenant}`,`/brands/${f.brand}/scripts/invalid?organization=${f.tenant}`]){
      const response=await page.goto(wrong);expect([200,404]).toContain(response?.status());
      await expect(page.getByRole('heading',{name:'Сценарий недоступен',exact:true})).toBeVisible();await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute('content',/noindex/);await expect(page.getByRole('heading',{name:f.title,exact:true})).toHaveCount(0);await expect(page.getByText(f.current.hook,{exact:true})).toHaveCount(0);
    }
    await database.client`update organization_members set role='CLIENT_APPROVER' where tenant_id=${f.tenant} and user_id=${f.user}`;
    await page.goto(detail);await expect(page).toHaveURL(new RegExp(`/approvals\\?organization=${f.tenant}$`));
    await database.client`delete from organization_members where tenant_id=${f.tenant} and user_id=${f.user}`;
    const revoked=await page.goto(detail);expect([200,404]).toContain(revoked?.status());await expect(page.getByRole('heading',{name:'Сценарий недоступен',exact:true})).toBeVisible();await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute('content',/noindex/);await expect(page.getByRole('heading',{name:f.title,exact:true})).toHaveCount(0);await expect(page.getByText(f.current.hook,{exact:true})).toHaveCount(0);
    expect(await database.client`select id from jobs where tenant_id=${f.tenant}`).toHaveLength(0);
    const [saved]=await database.client`select current_version,approved_version from scripts where id=${f.script}`;expect(saved).toMatchObject({current_version:2,approved_version:1});
  }finally{await database.client`delete from sessions where user_id=${f.user}`;}
});
