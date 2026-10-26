import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { BrandRepository, createDatabase } from '../../packages/db/src/index';
import { BrandService } from '../../packages/core/src/brands';
import { hashPassword } from '../../packages/core/src/password';
import { emptyOnboarding } from '../../packages/types/src/index';
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('Dedicated test database required');
const database = createDatabase(url);
test.afterAll(() => database.close());
test('privacy center registers and cancels a request and revokes every session', async ({ page, context, browser, baseURL }, testInfo) => {
  const user = randomUUID(), password = 'Fixture privacy password 123!', correlation = randomUUID();
  await database.client`insert into users(id,email,name,password_hash,email_verified_at) values(${user},${`${user}@example.test`},'Privacy browser fixture',${await hashPassword(password)},now())`;
  async function session() {
    const token = randomBytes(32).toString('base64url');
    await database.client`insert into sessions(user_id,token_hash,expires_at) values(${user},${createHash('sha256').update(token).digest('hex')},now()+interval '1 hour')`;
    return token;
  }
  const brands = new BrandService(new BrandRepository(database.db));
  const tenant = (await brands.createOrganization(user, { name: 'Privacy brand owner' }, correlation)).id;
  const workspace = (await brands.overview(user, tenant)).workspaces[0]!;
  const brand = await brands.createBrand(user, tenant, { name: 'Privacy brand', workspaceId: workspace.id }, correlation);
  await brands.saveOnboarding(user, tenant, brand.id, { data: { ...emptyOnboarding('Privacy brand'), niche: 'Testing', geography: 'Online', usp: 'Clear', voice: 'Calm', products: [{ name: 'Product', description: '' }], audience: [{ name: 'Audience', description: '' }], pains: [{ name: 'Pain', description: '' }], goals: ['Trust'], platforms: ['TELEGRAM'], ctas: [{ name: 'Read', description: '' }] }, revision: 0, step: 14, complete: true }, correlation);
  await context.addCookies([{ name: 'contentos_session', value: await session(), url: baseURL!, httpOnly: true, sameSite: 'Lax' }]);
  const second = await browser.newContext({ baseURL });
  await second.addCookies([{ name: 'contentos_session', value: await session(), url: baseURL!, httpOnly: true, sameSite: 'Lax' }]);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto('/dashboard'); await page.getByRole('link', { name: 'Приватность', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Приватность', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Отозвать согласия', exact: true })).toHaveAttribute('href', `/brands/${brand.id}/content?organization=${tenant}&tab=consents`);
    await page.getByRole('link', { name: 'Отозвать согласия', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'История разрешений', exact: true })).toBeVisible();
    await page.goto('/privacy');
    await expect(page.getByText('Активных сессий: 2', { exact: true })).toBeVisible();
    expect((await page.request.post('/api/v1/privacy/deletion', { data: { password, acknowledged: true, idempotencyKey: randomUUID() } })).status()).toBe(403);
    expect((await page.request.post('/api/v1/privacy/export', { data: { password } })).status()).toBe(403);
    await page.getByLabel('Пароль для скачивания данных', { exact: true }).fill(password);
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Скачать JSON', exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('contentos-account.json');
    const archive = JSON.parse(await readFile((await download.path())!, 'utf8'));
    expect(archive.providerKeyHistory).toEqual([]); expect(archive.scope).toContain('provider_key_creation_evidence'); expect(archive.version).toBe(2); expect(archive.scope).toContain('accepted_consent_evidence'); expect(archive).toHaveProperty('renewalConsentHistory'); expect(archive.profile.id).toBe(user); expect(archive.sessionHistory).toHaveLength(2);
    expect(JSON.stringify(archive)).not.toMatch(/passwordHash|tokenHash|scrypt/);
    await expect(page.getByLabel('Пароль для скачивания данных', { exact: true })).toHaveValue('');
    await page.getByLabel('Текущий пароль', { exact: true }).fill('wrong-password');
    await page.getByRole('checkbox', { name: 'Я понимаю, что отправляю запрос, а удаление ещё не выполнено.' }).check();
    page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'Запросить удаление аккаунта', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Нет доступа' })).toContainText('Нет доступа');
    await expect(page.getByLabel('Текущий пароль', { exact: true })).toHaveValue('');
    await page.getByLabel('Текущий пароль', { exact: true }).fill(password);
    page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'Запросить удаление аккаунта', exact: true }).click();
    await expect(page.getByRole('status').filter({hasText:'Запрос зарегистрирован'})).toContainText('Запрос зарегистрирован');
    await page.reload();
    await expect(page.getByRole('button', { name: 'Отменить запрос', exact: true })).toBeVisible();
    expect(await database.client`select id from account_deletion_requests where user_id=${user} and status='REQUESTED'`).toHaveLength(1);
    const response = await page.request.get('/api/v1/privacy'); expect(response.headers()['cache-control']).toBe('no-store'); expect(await response.text()).not.toContain(password);
    await page.screenshot({ path: testInfo.outputPath('privacy-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('privacy-mobile.png'), fullPage: true });
    await page.getByRole('button', { name: 'Отменить запрос', exact: true }).click(); await expect(page.getByRole('status')).toContainText('Запрос отменён.');
    await expect(page.getByRole('button', { name: 'Запросить удаление аккаунта', exact: true })).toBeVisible();
    expect((await second.request.get('/api/v1/auth/session')).status()).toBe(200);
    page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'Выйти на всех устройствах', exact: true }).click();
    await expect(page).toHaveURL(/\/login$/); expect((await second.request.get('/api/v1/auth/session')).status()).toBe(401);
    expect(errors).toEqual([]);
  } finally { await second.close(); await database.client`delete from sessions where user_id=${user}`; }
});

test('resource-free account explicitly erases authentication data without reinterpreting intake consent',async({page,context,baseURL},testInfo)=>{
 const user=randomUUID(),email=user+'@example.test',password='Disposable browser erasure 123!',token=randomBytes(32).toString('base64url');
 await database.client`insert into users(id,email,name,password_hash,email_verified_at) values(${user},${email},'Erasure browser fixture',${await hashPassword(password)},now())`;
 await database.client`insert into sessions(user_id,token_hash,expires_at) values(${user},${createHash('sha256').update(token).digest('hex')},now()+interval '1 hour')`;
 await database.client`insert into auth_tokens(user_id,token_hash,type,expires_at) values(${user},${randomUUID()},'RESET_PASSWORD',now()+interval '1 hour')`;
 await context.addCookies([{name:'contentos_session',value:token,url:baseURL!,httpOnly:true,sameSite:'Lax'}]);
 try{
  await page.goto('/privacy');await page.getByLabel('Текущий пароль',{exact:true}).fill(password);
  await page.getByLabel('Я понимаю, что отправляю запрос, а удаление ещё не выполнено.',{exact:true}).check();
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Запросить удаление аккаунта',exact:true}).click();
  const panel=page.getByRole('region',{name:'Удаление профиля и данных входа',exact:true});await expect(panel).toBeVisible();
  expect(await database.client`select id from account_erasures where user_id=${user}`).toHaveLength(0);
  expect((await page.request.post('/api/v1/privacy/erasure',{data:{}})).status()).toBe(403);
  const submit=panel.getByRole('button',{name:'Закрыть аккаунт и удалить данные входа',exact:true});await expect(submit).toBeDisabled();
  await panel.getByLabel('Пароль для закрытия аккаунта',{exact:true}).fill(password);
  await panel.getByLabel('Подтверждаю необратимое удаление профиля и данных входа и выход на всех устройствах',{exact:true}).check();await expect(submit).toBeDisabled();
  await panel.getByLabel('Понимаю состав удаления и сохранение технического журнала и общих данных',{exact:true}).check();await expect(submit).toBeEnabled();await submit.click();
  await expect(page.getByRole('heading',{name:'Доступ к аккаунту закрыт',exact:true})).toBeVisible();
  expect((await page.request.get('/api/v1/me')).status()).toBe(401);
  await expect.poll(async()=>{const [row]=await database.client`select status from account_erasures where user_id=${user}`;return row?.status;},{timeout:30000}).toBe('COMPLETED');
  const [profile]=await database.client`select email,name,email_verified_at,erased_at from users where id=${user}`;
  expect(profile).toMatchObject({email:`deleted+${user}@account.invalid`,name:'Удалённый аккаунт',email_verified_at:null});expect(profile?.erased_at).not.toBeNull();
  expect(await database.client`select id from sessions where user_id=${user}`).toHaveLength(0);expect(await database.client`select id from auth_tokens where user_id=${user}`).toHaveLength(0);
  expect(await database.client`select id from audit_logs where user_id=${user} and action='ACCOUNT_AUTH_ERASURE_COMPLETED'`).toHaveLength(1);
  await page.screenshot({path:testInfo.outputPath('account-auth-erasure.png'),fullPage:true});
 }finally{await database.client`delete from sessions where user_id=${user}`;}
});
