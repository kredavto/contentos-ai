import {test,expect} from '@playwright/test';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {readFile,writeFile,mkdtemp,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createDatabase,BrandRepository} from '../../packages/db/src/index';
import {BrandService} from '../../packages/core/src/brands';
const url=process.env.TEST_DATABASE_URL;if(!url||!new URL(url).pathname.endsWith('_test'))throw new Error('Dedicated test database required');
const database=createDatabase(url);test.afterAll(()=>database.close());

function silentWav(){
  const bytes=Buffer.alloc(44+16000*2);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(16000,24);bytes.writeUInt32LE(32000,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(bytes.length-44,40);return bytes;
}
for(const kind of ['video','audio'] as const){
test(`${kind} library runs through API, S3, BullMQ, FFmpeg, browser playback and private deletion`,async({page,context,request,baseURL})=>{
  const user=randomUUID(),token=randomBytes(32).toString('base64url'),correlation=randomUUID(),service=new BrandService(new BrandRepository(database.db));
  await database.client`insert into users(id,email,password_hash,name,email_verified_at) values(${user},${`${user}@example.test`},'unusable','Media browser',now())`;
  await database.client`insert into sessions(user_id,token_hash,expires_at) values(${user},${createHash('sha256').update(token).digest('hex')},now()+interval '1 hour')`;
  const tenant=(await service.createOrganization(user,{name:'Media browser'},correlation)).id,workspace=(await service.overview(user,tenant)).workspaces[0]!;
  const brand=(await service.createBrand(user,tenant,{name:'Медиа',workspaceId:workspace.id},correlation)).id;
  await context.addCookies([{name:'contentos_session',value:token,url:baseURL!,httpOnly:true,sameSite:'Lax'}]);
  const base=`/api/v1/organizations/${tenant}/brands/${brand}/library-media`,headers={Origin:baseURL!};
  const bytes=kind==='video'?await readFile(join(tmpdir(),'contentos-e2e-video.mp4')):silentWav();
  const mimeType=kind==='video'?'video/mp4':'audio/wav',openLabel=kind==='video'?'Открыть видео':'Прослушать аудио';
  const input={name:`Фрагмент ${kind} для медиатеки`,source:{mimeType,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')},idempotencyKey:randomUUID()};
  expect((await request.get(base)).status()).toBe(401);
  expect((await page.request.post(base,{headers:{Origin:'https://untrusted.example'},data:input})).status()).toBe(403);
  const response=await page.request.post(base,{headers,data:input});expect(response.status()).toBe(201);expect(response.headers()['cache-control']).toBe('no-store');
  const intent=(await response.json()).data as {id:string;status:string;upload:{url:string;fields:Record<string,string>;expiresInSeconds:number}};
  expect(intent.status).toBe('UPLOADING');expect(intent.upload.expiresInSeconds).toBeLessThanOrEqual(300);
  expect((await page.request.get(`${base}/${intent.id}/download`)).status()).toBe(404);
  const badUpload=await request.post(intent.upload.url,{multipart:{...intent.upload.fields,'Content-Type':'text/html',file:{name:kind==='video'?'source.mp4':'source.wav',mimeType,buffer:bytes}}});expect(badUpload.status()).toBe(403);
  const uploaded=await request.post(intent.upload.url,{multipart:{...intent.upload.fields,file:{name:kind==='video'?'source.mp4':'source.wav',mimeType,buffer:bytes}}});expect(uploaded.status()).toBe(204);
  expect((await page.request.post(`${base}/${intent.id}/confirm`,{headers})).status()).toBe(202);
  expect((await page.request.post(`${base}/${intent.id}/confirm`,{headers})).status()).toBe(202);
  await expect.poll(async()=>(await database.client`select status from library_media where id=${intent.id}`)[0]?.status,{timeout:60000}).toBe('READY');
  const [row]=await database.client`select * from library_media where id=${intent.id}`;expect(row).toMatchObject({attempt:1,mime_type:kind==='video'?'video/mp4':'audio/mpeg',width:kind==='video'?320:null,height:kind==='video'?240:null,has_audio:true});expect(row!.duration_ms).toBeGreaterThanOrEqual(1000);
  const download=await page.request.get(`${base}/${intent.id}/download`);expect(download.status()).toBe(200);const signed=(await download.json()).data.url;
  const file=await request.get(signed);expect(file.status()).toBe(200);expect((await file.body()).length).toBeGreaterThan(100);if(kind==='video')expect((await file.body()).toString('ascii',4,8)).toBe('ftyp');
  const overview=(await (await page.request.get(base)).json()).data;expect(overview.assets).toHaveLength(1);expect(JSON.stringify(overview)).not.toContain('sourceKey');expect(JSON.stringify(overview)).not.toContain('storageKey');
  const studio=`/brands/${brand}/content?organization=${tenant}&tab=media`;
  await page.goto(studio);
  const panel=page.getByRole('region',{name:'Аудио и видео'}),card=panel.getByRole('article',{name:input.name});
  await expect(card.getByText('Готово',{exact:true})).toBeVisible();
  await card.getByRole('button',{name:openLabel}).click();
  await expect.poll(()=>card.locator(kind).evaluate((element:HTMLVideoElement)=>element.readyState)).toBeGreaterThanOrEqual(1);
  await card.getByRole('button',{name:'Закрыть просмотр'}).click();
  await expect(card.locator(kind)).toHaveCount(0);
  await page.setViewportSize({width:390,height:844});
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await panel.screenshot({path:join(tmpdir(),`contentos-library-${kind}-mobile.png`)});
  await page.route(`**${base}`,route=>route.fulfill({status:503,json:{error:{message:'Проверка восстановления списка'}}}),{times:1});
  await expect(panel.getByRole('alert')).toContainText('Проверка восстановления списка');
  await expect(card).toHaveCount(0);
  await expect(card).toBeVisible();
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await database.client`update organization_members set role='VIEWER' where tenant_id=${tenant} and user_id=${user}`;
  await page.reload();await expect(card).toBeVisible();
  await expect(panel.getByRole('button',{name:'Удалить файл'})).toHaveCount(0);
  await card.getByRole('button',{name:openLabel}).click();
  await expect(card.locator(kind)).toBeVisible();
  expect((await page.request.post(base,{headers,data:{...input,idempotencyKey:randomUUID()}})).status()).toBe(403);
  expect((await page.request.post(`${base}/${intent.id}/delete`,{headers})).status()).toBe(403);
  expect((await page.request.get(`${base}/${intent.id}/download`)).status()).toBe(200);
  await database.client`update organization_members set role='OWNER' where tenant_id=${tenant} and user_id=${user}`;
  await page.reload();await card.getByRole('button',{name:openLabel}).click();
  await card.getByRole('button',{name:'Удалить файл'}).click();
  await expect(card.getByText('Удаляется',{exact:true})).toBeVisible();
  await expect(card.locator(kind)).toHaveCount(0);
  await expect(card.getByRole('button',{name:openLabel})).toHaveCount(0);
  expect((await page.request.get(`${base}/${intent.id}/download`)).status()).toBe(404);
  await database.client`update library_media set cleanup_after=now() where id=${intent.id}`;
  await expect.poll(async()=>(await database.client`select status from library_media where id=${intent.id}`)[0]?.status).toBe('DELETED');
  await expect(card).toHaveCount(0);
  await expect(panel.getByText('Аудио и видео пока нет.')).toBeVisible();
  expect((await request.get(signed)).status()).toBe(404);
  expect((await database.client`select name,source_sha256 from library_media where id=${intent.id}`)[0]).toEqual({name:'[deleted]',source_sha256:'0'.repeat(64)});
});
}

for(const kind of ['video','audio'] as const){
  test(`${kind} uploads from the form and recovers a lost server acknowledgement without duplicates`,async({page,context,request,baseURL})=>{
    const user=randomUUID(),token=randomBytes(32).toString('base64url'),correlation=randomUUID(),service=new BrandService(new BrandRepository(database.db));
    await database.client`insert into users(id,email,password_hash,name,email_verified_at) values(${user},${`${user}@example.test`},'unusable','Browser upload',now())`;
    await database.client`insert into sessions(user_id,token_hash,expires_at) values(${user},${createHash('sha256').update(token).digest('hex')},now()+interval '1 hour')`;
    const tenant=(await service.createOrganization(user,{name:'Browser upload'},correlation)).id,workspace=(await service.overview(user,tenant)).workspaces[0]!;
    const brand=(await service.createBrand(user,tenant,{name:'Загрузка',workspaceId:workspace.id},correlation)).id;
    await context.addCookies([{name:'contentos_session',value:token,url:baseURL!,httpOnly:true,sameSite:'Lax'}]);
    const base=`/api/v1/organizations/${tenant}/brands/${brand}/library-media`;
    await page.goto(`/brands/${brand}/content?organization=${tenant}&tab=media`);
    const panel=page.getByRole('region',{name:'Аудио и видео'}),form=panel.getByRole('form',{name:'Загрузка аудио и видео'});
    await expect(form.getByLabel('Аудио или видео',{exact:true})).toBeEnabled();
    await form.getByLabel('Аудио или видео',{exact:true}).evaluate((element:HTMLInputElement)=>{const transfer=new DataTransfer();transfer.items.add(new File([new Uint8Array(64*1024*1024+1)],'too-large.mp4',{type:'video/mp4'}));element.files=transfer.files;element.dispatchEvent(new Event('change',{bubbles:true}));});
    await form.getByRole('button',{name:'Загрузить аудио или видео'}).click();
    await expect(form.getByRole('alert')).toContainText('до 64 МБ');
    expect((await database.client`select count(*)::int as count from library_media where tenant_id=${tenant}`)[0]?.count).toBe(0);
    const bytes=kind==='video'?await readFile(join(tmpdir(),'contentos-e2e-video.mp4')):silentWav(),mimeType=kind==='video'?'video/mp4':'audio/wav';
    await form.getByLabel('Аудио или видео',{exact:true}).setInputFiles({name:kind==='video'?'clip.mp4':'sound.wav',mimeType,buffer:bytes});
    const name=`Загруженный ${kind}`;
    await form.getByLabel('Название файла',{exact:true}).fill(name);
    let writes=0,sourceUrl='';
    await page.route(`**${base}/*/source`,async route=>{
      writes++;sourceUrl=route.request().url();
      const response=await route.fetch();expect(response.status()).toBe(202);
      await route.abort('failed');
    });
    await form.getByRole('button',{name:'Загрузить аудио или видео'}).click();
    await expect(form.getByRole('alert')).toContainText('Связь прервалась');
    await form.getByRole('button',{name:'Повторить загрузку'}).click();
    await expect(form.getByRole('status')).toContainText(/Файл принят|Файл уже готов/);
    expect(writes).toBe(1);
    const rows=await database.client`select id from library_media where tenant_id=${tenant}`;expect(rows).toHaveLength(1);
    const card=panel.getByRole('article',{name});
    await expect(card.getByText('Готово',{exact:true})).toBeVisible({timeout:60000});
    await card.getByRole('button',{name:kind==='video'?'Открыть видео':'Прослушать аудио'}).click();
    await expect.poll(()=>card.locator(kind).evaluate((element:HTMLMediaElement)=>element.readyState)).toBeGreaterThanOrEqual(1);
    await page.setViewportSize({width:390,height:844});
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    await panel.screenshot({path:join(tmpdir(),`contentos-upload-${kind}-mobile.png`)});
    expect((await request.post(sourceUrl,{headers:{Origin:baseURL!,'Content-Type':mimeType},data:bytes})).status()).toBe(401);
    expect((await page.request.post(sourceUrl,{headers:{Origin:'https://untrusted.example','Content-Type':mimeType},data:bytes})).status()).toBe(403);
    await database.client`update organization_members set role='VIEWER' where tenant_id=${tenant} and user_id=${user}`;
    expect((await page.request.post(sourceUrl,{headers:{Origin:baseURL!,'Content-Type':mimeType},data:bytes})).status()).toBe(403);
    await page.reload();await expect(panel.getByRole('form')).toHaveCount(0);await expect(card).toBeVisible();
  });
}

test('reload recovers the same upload intent and rejects a different source file',async({page,context,baseURL})=>{
  const user=randomUUID(),token=randomBytes(32).toString('base64url'),correlation=randomUUID(),service=new BrandService(new BrandRepository(database.db));
  await database.client`insert into users(id,email,password_hash,name,email_verified_at) values(${user},${`${user}@example.test`},'unusable','Resume upload',now())`;
  await database.client`insert into sessions(user_id,token_hash,expires_at) values(${user},${createHash('sha256').update(token).digest('hex')},now()+interval '1 hour')`;
  const tenant=(await service.createOrganization(user,{name:'Resume upload'},correlation)).id,workspace=(await service.overview(user,tenant)).workspaces[0]!;
  const brand=(await service.createBrand(user,tenant,{name:'Продолжение',workspaceId:workspace.id},correlation)).id;
  await context.addCookies([{name:'contentos_session',value:token,url:baseURL!,httpOnly:true,sameSite:'Lax'}]);
  const base=`/api/v1/organizations/${tenant}/brands/${brand}/library-media`,bytes=silentWav();
  await page.goto(`/brands/${brand}/content?organization=${tenant}&tab=media`);
  const panel=page.getByRole('region',{name:'Аудио и видео'}),form=panel.getByRole('form',{name:'Загрузка аудио и видео'});
  await expect(form.getByLabel('Аудио или видео',{exact:true})).toBeEnabled();
  await form.getByLabel('Аудио или видео',{exact:true}).setInputFiles({name:'resume.wav',mimeType:'audio/wav',buffer:bytes});
  await page.route(`**${base}/*/source`,route=>route.abort('failed'),{times:1});
  await form.getByRole('button',{name:'Загрузить аудио или видео'}).click();
  await expect(form.getByRole('alert')).toContainText('Связь прервалась');
  const [original]=await database.client`select id,idempotency_key from library_media where tenant_id=${tenant}`;expect(original).toBeTruthy();
  await page.reload();
  const card=panel.getByRole('article',{name:'resume.wav'});
  await card.getByRole('button',{name:'Продолжить загрузку файла'}).click();
  await expect(form.getByText('Продолжение загрузки', {exact:false})).toBeVisible();
  await expect(form.getByLabel('Название файла',{exact:true})).toBeDisabled();
  const wrong=Buffer.from(bytes);wrong[wrong.length-1]=1;
  await form.getByLabel('Аудио или видео',{exact:true}).setInputFiles({name:'resume.wav',mimeType:'audio/wav',buffer:wrong});
  await form.getByRole('button',{name:'Продолжить загрузку',exact:true}).click();
  await expect(form.getByRole('alert')).toContainText('Выбран другой файл');
  expect((await database.client`select status from library_media where id=${original!.id}`)[0]?.status).toBe('UPLOADING');
  await form.getByLabel('Аудио или видео',{exact:true}).setInputFiles({name:'renamed-original.wav',mimeType:'audio/wav',buffer:bytes});
  await form.getByRole('button',{name:'Продолжить загрузку',exact:true}).click();
  await expect(form.getByRole('status')).toContainText('Файл принят');
  await expect(card.getByText('Готово',{exact:true})).toBeVisible({timeout:60000});
  const recovered=await database.client`select id,idempotency_key from library_media where tenant_id=${tenant}`;expect(recovered).toHaveLength(1);expect(recovered[0]).toEqual(original);
  await expect(card.getByRole('button',{name:'Продолжить загрузку файла'})).toHaveCount(0);
  await form.getByRole('button',{name:'Новая загрузка'}).click();
  await expect(form.getByLabel('Название файла',{exact:true})).toHaveValue('');
});

test('64 MiB browser upload resumes 22 chunks after a lost acknowledgement and is privately removed',async({page,context,request,baseURL})=>{
  const user=randomUUID(),token=randomBytes(32).toString('base64url'),correlation=randomUUID(),service=new BrandService(new BrandRepository(database.db));
  await database.client`insert into users(id,email,password_hash,name,email_verified_at) values(${user},${`${user}@example.test`},'unusable','Chunk upload',now())`;
  await database.client`insert into sessions(user_id,token_hash,expires_at) values(${user},${createHash('sha256').update(token).digest('hex')},now()+interval '1 hour')`;
  const tenant=(await service.createOrganization(user,{name:'Chunk upload'},correlation)).id,workspace=(await service.overview(user,tenant)).workspaces[0]!;
  const brand=(await service.createBrand(user,tenant,{name:'Большие файлы',workspaceId:workspace.id},correlation)).id;
  await context.addCookies([{name:'contentos_session',value:token,url:baseURL!,httpOnly:true,sameSite:'Lax'}]);
  const base=`/api/v1/organizations/${tenant}/brands/${brand}/library-media`;
  // Real valid PCM WAV at the exact source-size limit: stereo 192 kHz, below 180 seconds.
  const bytes=Buffer.alloc(64*1024*1024);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(2,22);bytes.writeUInt32LE(192000,24);bytes.writeUInt32LE(768000,28);bytes.writeUInt16LE(4,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(bytes.length-44,40);
  await page.goto(`/brands/${brand}/content?organization=${tenant}&tab=media`);
  const panel=page.getByRole('region',{name:'Аудио и видео'}),form=panel.getByRole('form',{name:'Загрузка аудио и видео'});
  await expect(form.getByLabel('Аудио или видео',{exact:true})).toBeEnabled();
  // Playwright buffer payloads are limited to 50 MiB; exercise the real file picker with a disk file.
  const directory=await mkdtemp(join(tmpdir(),'contentos-chunk-browser-'));
  try{
  await writeFile(join(directory,'large.wav'),bytes);
  await form.getByLabel('Аудио или видео',{exact:true}).setInputFiles(join(directory,'large.wav'));
  const sent:number[]=[];let loseAck=true;
  await page.route(`**${base}/*/chunks/*`,async route=>{
    const index=Number(route.request().url().split('/').at(-1));sent.push(index);
    expect(route.request().postDataBuffer()!.length).toBeLessThanOrEqual(3*1024*1024);
    if(loseAck){loseAck=false;const response=await route.fetch();expect(response.status()).toBe(202);await route.abort('failed');}
    else await route.continue();
  });
  await form.getByRole('button',{name:'Загрузить аудио или видео'}).click();
  await expect(form.getByRole('alert')).toContainText('Связь прервалась');
  const [original]=await database.client`select id,uploaded_chunks from library_media where tenant_id=${tenant}`;
  expect(original?.uploaded_chunks).toEqual([0]);
  await page.reload();const card=panel.getByRole('article',{name:'large.wav'});
  await card.getByRole('button',{name:'Продолжить загрузку файла'}).click();
  await expect(form.getByText(/Сохранено частей: 1 из 22/)).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await panel.screenshot({path:join(tmpdir(),'contentos-chunk-resume-mobile.png')});
  await rename(join(directory,'large.wav'),join(directory,'large-renamed.wav'));
  await form.getByLabel('Аудио или видео',{exact:true}).setInputFiles(join(directory,'large-renamed.wav'));
  await form.getByRole('button',{name:'Продолжить загрузку',exact:true}).click();
  await expect(form.getByRole('status')).toContainText('Файл принят',{timeout:90000});
  expect(sent).toEqual(Array.from({length:22},(_,index)=>index));
  await expect(card.getByText('Готово',{exact:true})).toBeVisible({timeout:90000});
  const records=await database.client`select id,source_bytes,uploaded_chunks,attempt from library_media where tenant_id=${tenant}`;
  expect(records).toHaveLength(1);expect(records[0]).toMatchObject({id:original!.id,source_bytes:64*1024*1024,attempt:1});expect(records[0]!.uploaded_chunks).toHaveLength(22);
  await card.getByRole('button',{name:'Прослушать аудио'}).click();
  await expect.poll(()=>card.locator('audio').evaluate((element:HTMLAudioElement)=>element.readyState)).toBeGreaterThanOrEqual(1);
  // Fixture object inspection proves private quarantine parts are actually removed.
  const chunkUrl=`http://127.0.0.1:8027/contentos-e2e/${tenant}/uploads/${original!.id}/chunks/0`;
  expect((await request.get(chunkUrl)).status()).toBe(200);
  await card.getByRole('button',{name:'Удалить файл'}).click();
  await expect(card.getByText('Удаляется',{exact:true})).toBeVisible();
  await database.client`update library_media set cleanup_after=now() where id=${original!.id}`;
  await expect.poll(async()=>(await database.client`select status from library_media where id=${original!.id}`)[0]?.status).toBe('DELETED');
  expect((await request.get(chunkUrl)).status()).toBe(404);
  await expect(card).toHaveCount(0);
  }finally{await rm(directory,{recursive:true,force:true});}
});
