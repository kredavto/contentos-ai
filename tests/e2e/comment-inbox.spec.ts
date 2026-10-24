import {test,expect} from '@playwright/test';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {createDatabase,BrandRepository,LedgerRepository} from '../../packages/db/src/index';
import {BrandService} from '../../packages/core/src/brands';
import {comments} from '../../packages/db/src/schema/comments';
import {emptyOnboarding} from '../../packages/types/src/index';
const url=process.env.TEST_DATABASE_URL;
if(!url||!new URL(url).pathname.endsWith('_test'))throw new Error('Dedicated test database required');
const database=createDatabase(url);test.afterAll(()=>database.close());
test('comment inbox preserves plain text, thread pagination, triage and viewer boundaries',async({page,context,baseURL},testInfo)=>{
 const user=randomUUID(),token=randomBytes(32).toString('base64url'),correlation=randomUUID(),brands=new BrandService(new BrandRepository(database.db));
 await database.client`insert into users(id,email,password_hash,name,email_verified_at) values(${user},${`${user}@example.test`},'unusable','Comment browser fixture',now())`;
 await database.client`insert into sessions(user_id,token_hash,expires_at) values(${user},${createHash('sha256').update(token).digest('hex')},now()+interval '1 hour')`;
 const tenant=(await brands.createOrganization(user,{name:'Comment fixture'},correlation)).id;
 try{
  const workspace=(await brands.overview(user,tenant)).workspaces[0]!,brand=(await brands.createBrand(user,tenant,{workspaceId:workspace.id,name:'Comment fixture brand'},correlation)).id;
  await brands.saveOnboarding(user,tenant,brand,{revision:0,step:14,complete:true,data:{...emptyOnboarding('Comment fixture brand'),niche:'Education',geography:'Online',usp:'Practice',voice:'Calm',goals:['Trust'],platforms:['YOUTUBE'],products:[{name:'Course',description:''}],audience:[{name:'Students',description:''}],pains:[{name:'Time',description:''}],ctas:[{name:'Read',description:''}]}},correlation);
  const content=randomUUID(),connection=randomUUID(),calendar=randomUUID(),job=randomUUID(),publication=randomUUID(),root=randomUUID();
  await database.client`insert into social_connections(id,tenant_id,brand_id,provider,name,reference,idempotency_key,input_hash,status,created_by) values(${connection},${tenant},${brand},'youtube','Comment fixture',${JSON.stringify({provider:'youtube',internalId:connection,externalId:'UC'+'a'.repeat(22),metadata:{}})},${randomUUID()},'fixture','REVOKED',${user})`;
  await database.client`insert into content_items(id,tenant_id,brand_id,title,type) values(${content},${tenant},${brand},'Discussion fixture','POST')`;
  await database.client`insert into calendar_entries(id,tenant_id,brand_id,content_item_id,planned_at,time_zone,platform,caption,idempotency_key,input_hash,created_by) values(${calendar},${tenant},${brand},${content},now(),'UTC','YOUTUBE','Fixture',${randomUUID()},'fixture',${user})`;
  await database.client`insert into publishing_jobs(id,tenant_id,brand_id,calendar_id,calendar_revision,content_item_id,connection_id,credential_version,provider,snapshot,status,scheduled_at,next_attempt_at,idempotency_key,input_hash,approved_by,correlation_id) values(${job},${tenant},${brand},${calendar},0,${content},${connection},1,'youtube','{"title":"Discussion fixture"}'::jsonb,'PUBLISHED',now(),now(),${randomUUID()},'fixture',${user},${correlation})`;
  await database.client`insert into publications(id,tenant_id,job_id,provider,reference,published_at) values(${publication},${tenant},${job},'youtube',${JSON.stringify({provider:'youtube',internalId:publication,externalId:'abcdefghijk',metadata:{}})},now())`;
  const base=`/api/v1/organizations/${tenant}/brands/${brand}`,endpoint=`${base}/publications/${publication}/comments`;
  await context.addCookies([{name:'contentos_session',value:token,url:baseURL!,httpOnly:true,sameSite:'Lax'}]);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`/brands/${brand}/content?organization=${tenant}&tab=comments`);
  const panel=page.getByRole('region',{name:'Комментарии YouTube',exact:true});
  await panel.getByLabel('Публикация для комментариев').selectOption(publication);
  await expect(panel.getByText('Комментарии ещё не импортированы.',{exact:true})).toBeVisible();
  await expect(panel.getByRole('button',{name:'Импортировать комментарии'})).toBeDisabled();
  await expect(panel.getByText('Полнота импорта не подтверждена.',{exact:false})).toBeVisible();
  const time=new Date('2026-01-02T00:00:00Z'),text='<script>window.commentInjection=true</script> Как начать?';
  const common={tenantId:tenant,publicationId:publication,provider:'youtube',providerCreatedAt:time,providerUpdatedAt:time,firstObservedAt:time,lastObservedAt:time};
  await database.db.insert(comments).values({ ...common,id:root,externalCommentId:'root',externalThreadId:'thread',authorName:'Test author',text,replyCount:26,canReply:true,isPublic:true});
  await database.db.insert(comments).values(Array.from({length:26},(_,index)=>({...common,externalCommentId:`reply-${index}`,externalThreadId:'thread',parentId:root,text:`Reply ${index}`})));
  const list=panel.getByRole('region',{name:'Список комментариев',exact:true});await list.getByRole('button',{name:'Обновить список',exact:true}).click();
  await expect(panel.getByText(text,{exact:true})).toBeVisible();expect(await page.evaluate(()=>Object.hasOwn(window,'commentInjection'))).toBe(false);
  await panel.getByLabel('Разметка: Test author').selectOption('NEEDS_HUMAN');
  await expect(panel.getByLabel('Разметка: Test author')).toHaveValue('NEEDS_HUMAN');
  expect((await database.client`select status from comments where id=${root}`)[0]?.status).toBe('NEEDS_HUMAN');
  await panel.getByRole('button',{name:'Черновик ответа и история',exact:true}).click();
  const editor=panel.getByRole('region',{name:'Редактор черновика ответа',exact:true});
  await editor.getByLabel('Текст черновика').fill('Первый ручной ответ');await editor.getByRole('button',{name:'Сохранить черновик',exact:true}).click();
  await expect(editor.getByRole('heading',{name:'Версия 1 · Ручной черновик'})).toBeVisible();
  await editor.getByLabel('Текст черновика').fill('Уточнённый ручной ответ');await editor.getByRole('button',{name:'Сохранить черновик',exact:true}).click();
  await expect(editor.getByRole('heading',{name:'Версия 2 · Ручной черновик'})).toBeVisible();await expect(editor.getByText('Первый ручной ответ',{exact:true})).toBeVisible();
  expect((await database.client`select count(*)::int as count from comment_reply_versions where tenant_id=${tenant} and comment_id=${root}`)[0]?.count).toBe(2);
  await new LedgerRepository(database.db).adjust(tenant,'AI_CREDITS',20,randomUUID(),randomUUID());
  // Simulate a busy brand where this task is absent from the bounded overview.
  await page.route(`**${base}/content`,async route=>{const response=await route.fetch();const body=await response.json();body.data.jobs=[];await route.fulfill({response,json:body});});
  await editor.getByLabel('Текст черновика').fill('Несохранённая ручная правка');
  await editor.getByRole('button',{name:'Предложить AI-ответ',exact:false}).click();
  await expect(editor.getByText('AI-черновик готов.',{exact:false})).toBeVisible({timeout:60000});
  await expect(editor.getByLabel('Текст черновика')).toHaveValue('Несохранённая ручная правка');
  await editor.getByRole('button',{name:'Загрузить последнюю версию',exact:true}).click();
  await expect(editor.getByRole('heading',{name:'Версия 3 · AI-предложение'})).toBeVisible();
  await expect(editor.getByLabel('Текст черновика')).toHaveValue('[ДЕМО] Спасибо за ваш комментарий. Ответ требует проверки.');
  const generated=await database.client`select j.status,r.status as reservation_status from jobs j join usage_reservations r on r.id=j.reservation_id and r.tenant_id=j.tenant_id where j.tenant_id=${tenant} and j.brand_id=${brand} and j.type='DRAFT_COMMENT_REPLY'`;
  expect(generated).toHaveLength(1);expect(generated[0]).toMatchObject({status:'SUCCEEDED',reservation_status:'CAPTURED'});
  await panel.getByRole('button',{name:'Закрыть черновик',exact:true}).click();
  await panel.getByRole('button',{name:'Показать ответы (26)'}).click();
  const replies=panel.getByRole('region',{name:'Ответы на комментарий',exact:true});await expect(replies.locator('article')).toHaveCount(25);
  await replies.getByRole('button',{name:'Следующая страница'}).click();await expect(replies.locator('article')).toHaveCount(1);
  await replies.getByRole('button',{name:'К началу списка'}).click();await expect(replies.locator('article')).toHaveCount(25);
  await page.setViewportSize({width:390,height:844});await expect(panel.getByText(text,{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('comment-inbox-mobile.png'),fullPage:true});
  await panel.getByRole('button',{name:'Скрыть ответы',exact:true}).click();
  // Synthetic HTTP transport exercises controls without a Google grant or remote import.
  const snapshot=(await (await page.request.get(endpoint)).json()).data;
  const importId=randomUUID();let phase:'NONE'|'QUEUED'|'PARTIAL'|'CANCELLED'='NONE',revision=0,requests=0;
  const keys:string[]=[];
  await page.route(`**${endpoint}**`,async route=>{
   const request=route.request(),path=new URL(request.url()).pathname;
   if(request.method()==='GET'&&path===endpoint){await route.fulfill({json:{data:{...snapshot,sync:{configuration:{ready:true,status:'CONFIGURED'},job:phase==='NONE'?null:{id:importId,status:phase,revision,completedPages:phase==='PARTIAL'?200:0,errorCode:null}}}}});return;}
   if(request.method()==='POST'&&path===`${endpoint}/imports`){
    const input=request.postDataJSON();keys.push(input.idempotencyKey);requests++;
    if(requests===1){await route.fulfill({status:503,json:{error:{message:'Synthetic retryable failure'}}});return;}
    phase='QUEUED';revision++;await route.fulfill({status:202,json:{data:{id:importId}}});return;
   }
   if(request.method()==='POST'&&path===`${endpoint}/imports/${importId}/resume`){expect(request.postDataJSON()).toEqual({revision});phase='QUEUED';revision++;await route.fulfill({status:202,json:{data:{id:importId}}});return;}
   if(request.method()==='POST'&&path===`${endpoint}/imports/${importId}/cancel`){expect(request.postDataJSON()).toEqual({revision});phase='CANCELLED';revision++;await route.fulfill({json:{data:{id:importId}}});return;}
   await route.continue();
  });
  await list.getByRole('button',{name:'Обновить список',exact:true}).click();
  const start=panel.getByRole('button',{name:'Импортировать комментарии',exact:true});await expect(start).toBeEnabled();await start.click();
  await expect(panel.getByRole('alert')).toHaveText('Synthetic retryable failure');await start.click();
  await expect(panel.getByText('Импорт в очереди',{exact:false})).toBeVisible();expect(keys).toHaveLength(2);expect(keys[0]).toBe(keys[1]);await expect(start).toBeDisabled();
  phase='PARTIAL';revision++;await list.getByRole('button',{name:'Обновить список',exact:true}).click();
  await expect(panel.getByText('Импорт частично выполнен',{exact:false})).toBeVisible();await expect(start).toBeDisabled();
  await panel.getByRole('button',{name:'Продолжить импорт',exact:true}).click();await expect(panel.getByText('Импорт в очереди',{exact:false})).toBeVisible();
  await panel.getByRole('button',{name:'Остановить импорт',exact:true}).click();await expect(panel.getByText('Импорт остановлен',{exact:false})).toBeVisible();await expect(start).toBeEnabled();
  await page.unroute(`**${endpoint}**`);
  await database.client`update organization_members set role='VIEWER' where tenant_id=${tenant} and user_id=${user}`;
  await page.reload();await panel.getByLabel('Публикация для комментариев').selectOption(publication);
  await expect(panel.getByText(text,{exact:true})).toBeVisible();await expect(panel.getByLabel('Разметка: Test author')).toHaveCount(0);await expect(panel.getByRole('button',{name:'Импортировать комментарии'})).toHaveCount(0);
  await panel.getByRole('button',{name:'Черновик ответа и история',exact:true}).click();
  await expect(editor.getByRole('heading',{name:'Версия 2 · Ручной черновик'})).toBeVisible();await expect(editor.getByLabel('Текст черновика')).toHaveCount(0);
  expect((await page.request.post(`${endpoint}/${root}/draft`,{headers:{origin:baseURL!},data:{revision:1,contentRevision:0,reviewRevision:1,reply:'Forbidden edit'}})).status()).toBe(403);
  expect((await page.request.patch(`${endpoint}/${root}`,{headers:{origin:baseURL!},data:{revision:1,contentRevision:0,status:'RESOLVED'}})).status()).toBe(403);
  expect((await page.request.get(`${base}/publications/${randomUUID()}/comments`)).status()).toBe(404);
  expect(errors).toEqual([]);
 }finally{await database.client`delete from sessions where user_id=${user}`;}
});
