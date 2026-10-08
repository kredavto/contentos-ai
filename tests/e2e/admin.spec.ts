import { test, expect } from '@playwright/test';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { createDatabase } from '../../packages/db/src/index';
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('Dedicated test database required');
const database = createDatabase(url);
test.afterAll(() => database.close());
test('platform operator reads safe data and revokes sessions with an audit record', async ({ page, context, browser, baseURL }, testInfo) => {
  const operator = randomUUID(), target = randomUUID(), tenant = randomUUID();
  async function account(userId: string) {
    const token = randomBytes(32).toString('base64url');
    await database.client`insert into users(id,email,name,password_hash,email_verified_at) values(${userId},${`${userId}@example.test`},'Admin browser fixture','password-sentinel',now())`;
    await database.client`insert into sessions(user_id,token_hash,expires_at) values(${userId},${createHash('sha256').update(token).digest('hex')},now()+interval '1 hour')`;
    return token;
  }
  const operatorToken = await account(operator), targetToken = await account(target);
  await database.client`insert into platform_operators(user_id,role) values(${operator},'SUPPORT')`;
  await database.client`insert into organizations(id,name) values(${tenant},'Tenant owner fixture')`;
  await database.client`insert into organization_members(tenant_id,user_id,role) values(${tenant},${target},'OWNER')`;
  const ordinary = await browser.newContext({ baseURL });
  await ordinary.addCookies([{ name: 'contentos_session', value: targetToken, url: baseURL!, httpOnly: true, sameSite: 'Lax' }]);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    const ordinaryPage = await ordinary.newPage();
    expect((await ordinaryPage.request.get('/api/admin/data?category=users')).status()).toBe(403);
    await ordinaryPage.goto(`/dashboard?organization=${tenant}`);
    await expect(ordinaryPage.getByRole('heading', { name: 'Здесь будут ваши бренды', exact: true })).toBeVisible();
    await expect(ordinaryPage.getByRole('link', { name: 'Администрирование', exact: true })).toHaveCount(0);
    await context.addCookies([{ name: 'contentos_session', value: operatorToken, url: baseURL!, httpOnly: true, sameSite: 'Lax' }]);
    await page.goto('/dashboard'); await page.getByRole('link', { name: 'Администрирование', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Конфигурация сервисов', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Обновить с начала', exact: true })).toBeEnabled();
    await page.getByLabel('ID пользователя (необязательно)', { exact: true }).fill(target);
    await page.getByRole('button', { name: 'Обновить с начала', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Обновить с начала', exact: true })).toBeEnabled();
    await expect(page.getByRole('table').getByText(`${target}@example.test`, { exact: true })).toBeVisible();
    const safe = await page.request.get(`/api/admin/data?category=users&userId=${target}`); expect(await safe.text()).not.toContain('password-sentinel');
    expect((await page.request.post('/api/admin/revoke-sessions', { data: { userId: target, reason: 'USER_REQUEST', ticket: 'BROWSER-1', idempotencyKey: randomUUID() } })).status()).toBe(403);
    await page.screenshot({ path: testInfo.outputPath('admin-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('admin-mobile.png'), fullPage: true });
    await page.getByLabel('ID пользователя для отзыва сессий', { exact: true }).fill(target);
    await page.getByLabel('Номер обращения', { exact: true }).fill('BROWSER-1');
    page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'Отозвать сессии', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Отозвано сессий:' })).toContainText('Отозвано сессий: 1');
    expect((await ordinaryPage.request.get('/api/me')).status()).toBe(401);
    expect((await database.client`select id from platform_actions where actor_id=${operator} and target_user_id=${target}`)).toHaveLength(1);
    await page.getByLabel('Раздел администрирования', { exact: true }).selectOption('actions');
    await expect(page.getByRole('table').getByText('BROWSER-1', { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await ordinary.close();
    await database.client`delete from platform_actions where actor_id=${operator}`;
    await database.client`delete from organizations where id=${tenant}`;
    for (const user of [operator, target]) await database.client`delete from users where id=${user}`;
  }
});
