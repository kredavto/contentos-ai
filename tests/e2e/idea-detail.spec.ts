import {test,expect} from '@playwright/test';
import {randomBytes,createHash} from 'node:crypto';
import {createDatabase} from '../../packages/db/src/index';
import {ideaDetailFixture} from '../helpers/idea-detail-fixture';
const url=process.env.TEST_DATABASE_URL;
if(!url||!new URL(url).pathname.endsWith('_test'))throw new Error('Dedicated test database required');
const database=createDatabase(url);test.afterAll(()=>database.close());
test('opens the exact old idea read-only from search with scoped reload and mobile layout',async({page,context,baseURL},testInfo)=>{
  const f=await ideaDetailFixture(database.client),token=randomBytes(32).toString('base64url');
  await database.client`insert into sessions(user_id,token_hash,expires_at) values(${f.user},${createHash('sha256').update(token).digest('hex')},now()+interval '1 hour')`;
  const detail=`/brands/${f.brand}/ideas/${f.idea}?organization=${f.tenant}`;
  try{
    await page.goto(detail);await expect(page).toHaveURL(/\/login$/);
    await context.addCookies([{name:'contentos_session',value:token,url:baseURL!,httpOnly:true,sameSite:'Lax'}]);
    await page.goto(`/dashboard?organization=${f.tenant}`);
    const search=page.getByRole('region',{name:'Поиск по организации'});
    await search.getByLabel('Тип результата').selectOption('IDEA');await search.getByLabel('Поисковый запрос').fill(f.title);await search.getByRole('button',{name:'Найти',exact:true}).click();
    await expect(search.locator('li')).toHaveCount(1);const link=search.getByRole('link',{name:'Открыть идею'});await expect(link).toHaveAttribute('href',detail);await link.click();
    await expect(page).toHaveURL(new RegExp(`/ideas/${f.idea}\\?organization=${f.tenant}$`));
    await expect(page.getByRole('heading',{level:1})).toHaveText(f.title);
    const text=page.getByRole('article',{name:'Текст идеи'});await expect(text).toContainText(f.hook);
    await expect(page.getByText('Статус: DRAFT',{exact:true})).toBeVisible();
    await expect(page.getByRole('main')).toHaveCount(1);await expect(page.locator('main textarea,main input,main form,main button')).toHaveCount(0);
    await expect(text.locator('script,img')).toHaveCount(0);
    const scores=page.getByRole('region',{name:'Оценка идеи'});await expect(scores).toContainText('<img src=x onerror=alert(1)>');await expect(scores.locator('img')).toHaveCount(0);
    await page.reload();await expect(page.getByRole('heading',{level:1})).toHaveText(f.title);await expect(text).toContainText(f.angle);
    await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:testInfo.outputPath('idea-detail-mobile.png'),fullPage:true});
    for(const wrong of [`/brands/${f.otherBrand}/ideas/${f.idea}?organization=${f.tenant}`,`/brands/${f.foreign}/ideas/${f.idea}?organization=${f.foreign}`,`${detail}&organization=${f.tenant}`,`/brands/${f.brand}/ideas/invalid?organization=${f.tenant}`]){
      const response=await page.goto(wrong);expect([200,404]).toContain(response?.status());
      await expect(page.getByRole('heading',{name:'Идея недоступна',exact:true})).toBeVisible();await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute('content',/noindex/);await expect(page.getByRole('heading',{name:f.title,exact:true})).toHaveCount(0);await expect(page.getByText(f.hook,{exact:true})).toHaveCount(0);
    }
    await database.client`update organization_members set role='CLIENT_APPROVER' where tenant_id=${f.tenant} and user_id=${f.user}`;
    await page.goto(detail);await expect(page).toHaveURL(new RegExp(`/approvals\\?organization=${f.tenant}$`));
    await database.client`delete from organization_members where tenant_id=${f.tenant} and user_id=${f.user}`;
    const revoked=await page.goto(detail);expect([200,404]).toContain(revoked?.status());await expect(page.getByRole('heading',{name:'Идея недоступна',exact:true})).toBeVisible();await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute('content',/noindex/);await expect(page.getByRole('heading',{name:f.title,exact:true})).toHaveCount(0);await expect(page.getByText(f.hook,{exact:true})).toHaveCount(0);
    expect(await database.client`select id from jobs where tenant_id=${f.tenant}`).toHaveLength(1);
    const [saved]=await database.client`select status from ideas where id=${f.idea}`;expect(saved).toMatchObject({status:'DRAFT'});
  }finally{await database.client`delete from sessions where user_id=${f.user}`;}
});
