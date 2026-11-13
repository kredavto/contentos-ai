import { test, expect } from '@playwright/test';

// Transport fixtures prove recovery/navigation UX, not SMTP or live account acceptance.
test('missing and malformed email links offer recovery without sending tokens', async ({ page }) => {
  let submissions = 0;
  await page.route('**/api/v1/auth/**', async route => { submissions++; await route.abort(); });
  for (const path of ['/verify', '/verify#token=invalid', '/reset-password', '/reset-password#token=invalid']) {
    await page.goto(path);
    await expect(page.getByRole('status')).toContainText('Откройте ссылку из письма');
    await expect(page.getByRole('button', { name: path.startsWith('/verify') ? 'Подтвердить почту' : 'Сохранить пароль' })).toBeDisabled();
    await expect(page).not.toHaveURL(/token=/);
    const recovery = path.startsWith('/verify') ? 'Получить новое письмо подтверждения' : 'Получить новую ссылку для смены пароля';
    await page.getByRole('link', { name: recovery }).click();
    await expect(page.getByLabel('Электронная почта')).toBeVisible();
  }
  expect(submissions).toBe(0);
});

test('registration exposes resend and blocks duplicate submissions while waiting and after success', async ({ page }) => {
  let submissions = 0;
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/auth/register', async route => {
    submissions++;
    expect(route.request().postDataJSON()).toEqual({ name: 'Тестовый пользователь', email: 'recovery@example.test', password: 'fixture-password-only' });
    await hold;
    await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ data: { message: 'Письмо поставлено в очередь отправки.' } }) });
  });
  await page.goto('/register');
  await page.getByLabel('Ваше имя').fill('Тестовый пользователь');
  await page.getByLabel('Электронная почта').fill('recovery@example.test');
  await page.getByLabel('Пароль', { exact: true }).fill('fixture-password-only');
  // Two synchronous events bypass the visual disabled state to exercise the guard.
  await page.locator('form').evaluate(form => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await expect.poll(() => submissions).toBe(1);
  await expect(page.getByRole('button', { name: 'Создать аккаунт' })).toBeDisabled();
  release();
  await expect(page.getByRole('status')).toContainText('очередь');
  await page.locator('form').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(submissions).toBe(1);
  await page.getByRole('link', { name: 'Получить новое письмо подтверждения' }).click();
  await expect(page.getByRole('heading', { name: 'Новое письмо подтверждения' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Отправить письмо' })).toBeEnabled();
});

test('failed verification can retry; reload never stores or silently reuses the token', async ({ page }) => {
  const token = 'a'.repeat(43);
  let calls = 0;
  await page.route('**/api/v1/auth/verify-email', async route => {
    calls++;
    expect(route.request().postDataJSON()).toEqual({ token });
    await route.fulfill({ status: calls === 1 ? 503 : 200, contentType: 'application/json', body: JSON.stringify(calls === 1 ? { error: { message: 'Попробуйте ещё раз' } } : { data: { message: 'Почта подтверждена' } }) });
  });
  await page.goto(`/verify#token=${token}`);
  await expect(page.getByRole('button', { name: 'Подтвердить почту' })).toBeEnabled();
  await expect(page).not.toHaveURL(/token=/);
  await page.getByRole('button', { name: 'Подтвердить почту' }).click();
  await expect(page.locator('form').getByRole('alert')).toHaveText('Попробуйте ещё раз');
  await page.getByRole('button', { name: 'Подтвердить почту' }).click();
  await expect(page.getByRole('status')).toHaveText('Почта подтверждена');
  expect(calls).toBe(2);
  await page.reload();
  await expect(page.getByRole('status')).toContainText('Откройте ссылку из письма');
  await expect(page.getByRole('button', { name: 'Подтвердить почту' })).toBeDisabled();
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain(token);
});


test('leaving a pending login does not let its late response redirect the new page', async ({ page }) => {
  let release!: () => void;
  let arrived = false;
  const hold = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/auth/login', async route => {
    arrived = true;
    await hold;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: {} }) }).catch(() => {});
  });
  await page.goto('/login');
  await page.getByLabel('Электронная почта').fill('recovery@example.test');
  await page.getByLabel('Пароль', { exact: true }).fill('fixture-password-only');
  await page.getByRole('button', { name: 'Войти в пространство' }).click();
  await expect.poll(() => arrived).toBe(true);
  await page.getByRole('link', { name: 'Забыли пароль?' }).click();
  await expect(page.getByRole('heading', { name: 'Восстановить доступ' })).toBeVisible();
  release();
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(/\/forgot-password$/);
  await expect(page.getByRole('button', { name: 'Отправить письмо' })).toBeEnabled();
});

test('password reset submits the captured link and new password exactly once', async ({ page }) => {
  const token = 'b'.repeat(43);
  let calls = 0;
  await page.route('**/api/v1/auth/reset-password', async route => {
    calls++;
    expect(route.request().postDataJSON()).toEqual({ token, password: 'new-fixture-password-only' });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { message: 'Пароль изменён' } }) });
  });
  await page.goto(`/reset-password#token=${token}`);
  await page.getByLabel('Пароль', { exact: true }).fill('new-fixture-password-only');
  await page.getByRole('button', { name: 'Сохранить пароль' }).click();
  await expect(page.getByRole('status')).toHaveText('Пароль изменён');
  await expect(page.getByRole('button', { name: 'Сохранить пароль' })).toBeDisabled();
  expect(calls).toBe(1);
  await page.getByRole('link', { name: 'Войти в аккаунт' }).click();
  await expect(page.getByRole('button', { name: 'Войти в пространство' })).toBeEnabled();
});
