import {test,expect} from '@playwright/test';
import {randomBytes,createHash} from 'node:crypto';
import {createDatabase} from '../../packages/db/src/index';
import {contentDetailFixture} from '../helpers/content-detail-fixture';
const url=process.env.TEST_DATABASE_URL;
if(!url||!new URL(url).pathname.endsWith('_test'))throw new Error('Dedicated test database required');
const database=createDatabase(url);test.afterAll(()=>database.close());
test('opens exact current post and archived carousel from search without mutation or media',async({page,context,baseURL},testInfo)=>{
  const f=await contentDetailFixture(database.client),token=randomBytes(32).toString('base64url');
  await database.client`insert into sessions(user_id,token_hash,expires_at) values(${f.user},${createHash('sha256').update(token).digest('hex')},now()+interval '1 hour')`;
  const path=(id:string)=>`/brands/${f.brand}/content/${id}?organization=${f.tenant}`;
  try{
    await page.goto(path(f.postContentId));await expect(page).toHaveURL(/\/login$/);
    await context.addCookies([{name:'contentos_session',value:token,url:baseURL!,httpOnly:true,sameSite:'Lax'}]);
    for(const target of [{id:f.postContentId,title:f.postTitle,body:f.post.body,screenshot:'content-post-mobile.png'},{id:f.carouselContentId,title:f.carouselTitle,body:f.carousel.caption,screenshot:'content-carousel-mobile.png'}]){
      await page.goto(`/dashboard?organization=${f.tenant}`);
      const search=page.getByRole('region',{name:'Поиск по организации'});
      await search.getByLabel('Тип результата').selectOption('CONTENT');await search.getByLabel('Поисковый запрос').fill(target.title);await search.getByRole('button',{name:'Найти',exact:true}).click();
      await expect(search.locator('li')).toHaveCount(1);const link=search.getByRole('link',{name:'Открыть материал'});await expect(link).toHaveAttribute('href',path(target.id));await link.click();
      await expect(page).toHaveURL(new RegExp(`/content/${target.id}\\?organization=${f.tenant}$`));await expect(page.getByRole('heading',{level:1})).toHaveText(target.title);
      const text=page.getByRole('article',{name:'Текст материала'});await expect(text).toContainText(target.body);await expect(text).not.toContainText('Historical');
      await expect(page.getByRole('main')).toHaveCount(1);await expect(page.locator('main textarea,main input,main form,main button,main video,main audio,main iframe')).toHaveCount(0);
      await expect(text.locator('script,img')).toHaveCount(0);await expect(page.getByRole('region',{name:'Проверка фактов'}).locator('script,img')).toHaveCount(0);
      if(target.id===f.postContentId)await expect(page.getByText('Текущая версия одобрена',{exact:true})).toBeVisible();
      else{await expect(page.getByText('Текущая версия не одобрена',{exact:true})).toBeVisible();await expect(page.getByText('Карусель в архиве · Ревизия состояния: 1',{exact:true})).toBeVisible();await expect(text).toContainText(f.carousel.slides[1]!.body);}
      await page.reload();await expect(text).toContainText(target.body);
      await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:testInfo.outputPath(target.screenshot),fullPage:true});
    }
    await page.goto(path(f.videoContentId));await expect(page.getByText(/Для этого типа здесь показаны только сведения/)).toBeVisible();await expect(page.getByRole('article',{name:'Текст материала'})).toHaveCount(0);await expect(page.locator('main video,main audio,main iframe,main img')).toHaveCount(0);
    await page.goto(path(f.emptyPostContentId));await expect(page.getByText(/ещё нет сохранённого текста соответствующего типа/)).toBeVisible();await expect(page.getByRole('article',{name:'Текст материала'})).toHaveCount(0);
    for(const wrong of [`/brands/${f.otherBrand}/content/${f.postContentId}?organization=${f.tenant}`,`/brands/${f.foreign}/content/${f.postContentId}?organization=${f.foreign}`,`${path(f.postContentId)}&organization=${f.tenant}`,path('invalid'),path(f.postId)]){
      const response=await page.goto(wrong);expect([200,404]).toContain(response?.status());await expect(page.getByRole('heading',{name:'Материал недоступен',exact:true})).toBeVisible();await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute('content',/noindex/);await expect(page.getByText(f.post.body,{exact:true})).toHaveCount(0);
    }
    await database.client`update organization_members set role='CLIENT_APPROVER' where tenant_id=${f.tenant} and user_id=${f.user}`;
    await page.goto(path(f.postContentId));await expect(page).toHaveURL(new RegExp(`/approvals\\?organization=${f.tenant}$`));
    await database.client`delete from organization_members where tenant_id=${f.tenant} and user_id=${f.user}`;
    await page.goto(path(f.carouselContentId));await expect(page.getByRole('heading',{name:'Материал недоступен',exact:true})).toBeVisible();await expect(page.getByText(f.carousel.caption,{exact:true})).toHaveCount(0);
    expect(await database.client`select id from jobs where tenant_id=${f.tenant}`).toHaveLength(0);expect(await database.client`select id from audit_logs where tenant_id=${f.tenant}`).toHaveLength(0);
    const [post]=await database.client`select current_version,approved_version from posts where id=${f.postId}`;expect(post).toMatchObject({current_version:2,approved_version:2});
    const [carousel]=await database.client`select current_version,approved_version,lifecycle_revision,archived_at = '2025-01-01T00:00:00Z'::timestamptz as archived_matches from carousels where id=${f.carouselId}`;expect(carousel).toMatchObject({current_version:2,approved_version:null,lifecycle_revision:1,archived_matches:true});
  }finally{await database.client`delete from sessions where user_id=${f.user}`;}
});
