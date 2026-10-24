import {test,expect} from '@playwright/test';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {createDatabase,BrandRepository} from '../../packages/db/src/index';
import {BrandService} from '../../packages/core/src/brands';
const url=process.env.TEST_DATABASE_URL;
if(!url||!new URL(url).pathname.endsWith('_test'))throw new Error('Dedicated test database required');
const database=createDatabase(url);test.afterAll(()=>database.close());
test('reviews exact post text and carousel artwork before assigned approval',async({page,context,baseURL},testInfo)=>{
  const owner=randomUUID(),reviewer=randomUUID(),post=randomUUID(),carousel=randomUUID(),correlation=randomUUID();
  const tokens=[randomBytes(32).toString('base64url'),randomBytes(32).toString('base64url')] as const;
  for(const [id,token,name] of [[owner,tokens[0],'Author'],[reviewer,tokens[1],'Reviewer']] as const){await database.client`insert into users(id,email,name,password_hash,email_verified_at) values(${id},${`${id}@example.test`},${name},'unusable',now())`;await database.client`insert into sessions(user_id,token_hash,expires_at) values(${id},${createHash('sha256').update(token).digest('hex')},now()+interval '1 hour')`;}
  const brands=new BrandService(new BrandRepository(database.db)),tenant=(await brands.createOrganization(owner,{name:'Text review'},correlation)).id,workspace=(await brands.overview(owner,tenant)).workspaces[0]!;
  const brand=(await brands.createBrand(owner,tenant,{workspaceId:workspace.id,name:'Text review brand'},correlation)).id;
  await database.client`insert into organization_members(tenant_id,user_id,role) values(${tenant},${reviewer},'CLIENT_APPROVER')`;
  for(const [id,type,title] of [[post,'POST','Review post'],[carousel,'CAROUSEL','Review carousel']] as const)await database.client`insert into content_items(id,tenant_id,brand_id,title,type) values(${id},${tenant},${brand},${title},${type})`;
  const postContent={title:'Review post',body:'Exact saved post body',hashtags:['review'],factCheckNotes:[]};
  const carouselContent={title:'Review carousel',slides:[{heading:'First heading',body:'First saved slide'},{heading:'Second heading',body:'Second saved slide'}],caption:'Exact saved caption',hashtags:['review'],factCheckNotes:[],design:{format:'SQUARE',font:'SANS',backgroundColor:'#ffffff',textColor:'#111111',accentColor:'#008800'}};
  await database.client`insert into posts(id,tenant_id,brand_id,content_item_id,platform) values(${post},${tenant},${brand},${post},'TELEGRAM')`;
  await database.client`insert into content_versions(tenant_id,post_id,version,content,created_by) values(${tenant},${post},1,${JSON.stringify(postContent)}::jsonb,${owner})`;
  await database.client`insert into carousels(id,tenant_id,brand_id,content_item_id,platform) values(${carousel},${tenant},${brand},${carousel},'INSTAGRAM')`;
  await database.client`insert into carousel_versions(tenant_id,carousel_id,version,content,created_by) values(${tenant},${carousel},1,${JSON.stringify(carouselContent)}::jsonb,${owner})`;
  async function login(token:string){await context.clearCookies();await context.addCookies([{name:'contentos_session',value:token,url:baseURL!,httpOnly:true,sameSite:'Lax'}]);}
  try{
    await login(tokens[0]);
    for(const [tab,label,id,noun] of [['posts','Сохранённый пост',post,'поста'],['carousels','Сохранённая карусель',carousel,'карусели']] as const){
      await page.goto(`/brands/${brand}/content?organization=${tenant}&tab=${tab}`);await page.getByLabel(label,{exact:true}).selectOption(id);
      const form=page.getByRole('region',{name:`Запрос согласования ${noun}`});await form.getByLabel('Согласующий',{exact:true}).selectOption(reviewer);await form.getByRole('button',{name:'Отправить на согласование'}).click();await expect(form.getByRole('status')).toHaveText('Запрос сохранён.');
    }
    await login(tokens[1]);await page.goto(`/approvals?organization=${tenant}`);
    const postCard=page.locator('article').filter({has:page.getByRole('heading',{name:'Review post · v1'})});await postCard.getByText('Пост на согласовании',{exact:true}).click();await expect(postCard.getByText('Exact saved post body',{exact:true})).toBeVisible();await postCard.getByRole('button',{name:'Одобрить версию'}).click();await expect(postCard.getByText('Одобрен',{exact:true})).toBeVisible();
    const card=page.locator('article').filter({has:page.getByRole('heading',{name:'Review carousel · v1'})});await card.getByText('Карусель на согласовании',{exact:true}).click();await expect(card.getByText('Exact saved caption',{exact:true})).toBeVisible();await expect(card.getByText('Second saved slide',{exact:true})).toBeVisible();await card.getByRole('combobox').selectOption('1');await expect(card.getByLabel('Слайд 2',{exact:true})).toBeVisible();
    expect(await card.locator('canvas').evaluate((node:HTMLCanvasElement)=>node.width>0&&node.height>0)).toBe(true);
    await page.setViewportSize({width:390,height:844});await card.scrollIntoViewIfNeeded();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:testInfo.outputPath('carousel-review-mobile.png')});
    await card.getByRole('button',{name:'Одобрить версию'}).click();await expect(card.getByText('Одобрен',{exact:true})).toBeVisible();
    expect((await database.client`select approved_version from posts where id=${post}`)[0]!.approved_version).toBe(1);expect((await database.client`select approved_version from carousels where id=${carousel}`)[0]!.approved_version).toBe(1);
  }finally{await database.client`delete from sessions where user_id in (${owner},${reviewer})`;}
});
