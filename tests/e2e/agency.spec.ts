import { test, expect } from '@playwright/test';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { createDatabase } from '../../packages/db/src/index';
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('Dedicated test database required');
const database = createDatabase(url);
test.afterAll(() => database.close());
test('agency opt-in, isolated client creation, archive and restore', async ({ page, context, baseURL }, testInfo) => {
  const owner = randomUUID(), tenant = randomUUID(), token = randomBytes(32).toString('base64url');
  await database.client`insert into users(id,email,name,password_hash,email_verified_at) values(${owner},${`${owner}@example.test`},'Agency owner','unusable',now())`;
  await database.client`insert into organizations(id,name) values(${tenant},'Агентство — тест')`;
  await database.client`insert into organization_members(tenant_id,user_id,role) values(${tenant},${owner},'OWNER')`;
  await database.client`insert into sessions(user_id,token_hash,expires_at) values(${owner},${createHash('sha256').update(token).digest('hex')},now()+interval '1 hour')`;
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await context.addCookies([{ name: 'contentos_session', value: token, url: baseURL!, httpOnly: true, sameSite: 'Lax' }]);
  try {
    await page.goto(`/clients?organization=${tenant}`);
    await page.getByRole('button', { name: 'Включить режим агентства', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Режим агентства включён' })).toBeVisible();
    expect((await page.request.post(`/api/organizations/${tenant}/agency/clients`, { data: { kind: 'CREATE', name: 'No origin', timezone: 'UTC', idempotencyKey: randomUUID() } })).status()).toBe(403);
    await page.getByLabel('Название нового клиента', { exact: true }).fill('Клиент Север');
    await page.getByRole('button', { name: 'Создать клиента', exact: true }).click();
    const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Клиент Север', exact: true }) });
    await expect(card).toBeVisible(); const clientUrl = await card.getByRole('link', { name: 'Открыть клиента', exact: true }).getAttribute('href');
    expect(clientUrl).toContain('/dashboard?organization=');
    await page.screenshot({ path: testInfo.outputPath('agency-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('agency-mobile.png'), fullPage: true });
    page.once('dialog', dialog => dialog.accept()); await card.getByRole('button', { name: 'В архив портфеля', exact: true }).click();
    await expect(card.getByText('В архиве портфеля', { exact: true })).toBeVisible();
    await card.getByRole('button', { name: 'Вернуть в портфель', exact: true }).click();
    await expect(card.getByText('Активный клиент', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Выключить режим агентства', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Режим агентства выключен' })).toBeVisible();
    await page.goto(clientUrl!); await expect(page.getByRole('heading', { name: 'Всё начинается с бренда' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Здесь будут ваши бренды', exact: true })).toBeVisible();
    expect(await page.getByLabel('Организация', { exact: true }).inputValue()).not.toBe(tenant);
    expect(errors).toEqual([]);
  } finally {
    const clients = await database.client`select client_organization_id from agency_clients where tenant_id=${tenant}`;
    await database.client`delete from organizations where id=${tenant}`;
    for (const row of clients) await database.client`delete from organizations where id=${row.client_organization_id as string}`;
    await database.client`delete from users where id=${owner}`;
  }
});
