import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
test('register, verify email, create organization and resume 15-step onboarding', async ({ page, request }) => {
  const email = `browser-${randomUUID()}@example.test`;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/register');
  await page.getByLabel('Ваше имя').fill('Тестовый редактор');
  await page.getByLabel('Электронная почта').fill(email);
  await page.getByLabel('Пароль', { exact: true }).fill('secure-test-password');
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page.getByRole('status')).toContainText('письмо');
  const response = await request.get(`http://127.0.0.1:8026/?recipient=${encodeURIComponent(email)}`);
  const messages = await response.json() as Array<{ text: string }>;
  const token = messages.at(-1)?.text.match(/token=([a-zA-Z0-9_-]+)/)?.[1];
  expect(token).toBeTruthy();
  await page.goto(`/verify#token=${token}`);
  await page.getByRole('button', { name: 'Подтвердить почту' }).click();
  await expect(page.getByRole('status')).toContainText('Почта подтверждена');
  await page.getByRole('link', { name: 'Войти в аккаунт' }).click();
  await page.getByLabel('Электронная почта').fill(email);
  await page.getByLabel('Пароль', { exact: true }).fill('secure-test-password');
  await page.getByRole('button', { name: 'Войти в пространство' }).click();
  await expect(page.getByRole('heading', { name: 'Всё начинается с бренда' })).toBeVisible();
  await page.getByLabel('Название организации').fill('Демо-организация');
  await page.getByRole('button', { name: 'Создать организацию', exact: true }).click();
  await page.getByRole('button', { name: 'Добавить бренд', exact: true }).click();
  await page.getByLabel('Название бренда').fill('Студия Север');
  await page.getByRole('button', { name: 'Перейти к настройке' }).click();
  await expect(page.getByRole('heading', { name: 'Как называется ваш бренд?' })).toBeVisible();
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await page.getByLabel('Сайт компании', { exact: true }).fill('https://example.test');
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await page.getByLabel('Сфера бизнеса', { exact: true }).fill('Дизайн жилых пространств');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Изменения сохранены');
  await page.reload();
  await expect(page.getByLabel('Сфера бизнеса', { exact: true })).toHaveValue('Дизайн жилых пространств');
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  const fields = [
    ['География', 'Россия, онлайн'], ['Продукты и услуги', 'Дизайн-проект | Проектирование квартир'],
    ['Целевая аудитория', 'Владельцы квартир | Планируют ремонт'], ['Проблемы аудитории', 'Сложный выбор | Не хватает времени'],
    ['Конкуренты', 'Другая студия | Дизайн интерьеров'], ['Позиционирование', 'Прозрачные этапы и сроки'],
    ['Tone of voice', 'Спокойно, понятно, профессионально'], ['Цели продвижения', 'Повышение доверия\nЗаявки'],
  ];
  for (const [label, value] of fields) {
    await page.getByLabel(label!, { exact: true }).fill(value!);
    await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  }
  await page.getByLabel('TELEGRAM', { exact: true }).check();
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await page.getByLabel('Призывы к действию', { exact: true }).fill('Консультация | Записаться на сайте');
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await page.getByLabel('Лид-магниты', { exact: true }).fill('Чек-лист | Подготовка к ремонту');
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await page.getByLabel('Ваши примеры', { exact: true }).fill('Пример поста | Как выбрать планировку');
  await page.getByRole('button', { name: 'Создать Brand Brain' }).click();
  await expect(page.getByRole('heading', { name: 'Brand Brain: Студия Север' })).toBeVisible();
  await expect(page.getByText('Дизайн-проект | Проектирование квартир', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'В рабочее пространство' }).click();
  await expect(page.getByText('Brand Brain готов', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/dashboard-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Добавить бренд', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/dashboard-mobile.png', fullPage: true });
  const sessionCookie = (await page.context().cookies()).find(cookie => cookie.name === 'contentos_session');
  expect(sessionCookie?.httpOnly).toBe(true);
  expect(sessionCookie?.sameSite).toBe('Lax');
  await page.getByRole('button', { name: 'Выйти из аккаунта', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect((await page.request.get('/api/organizations')).status()).toBe(401);
  expect(errors).toEqual([]);
});
test('rejects CSRF and anonymous access without exposing sensitive data', async ({ request }) => {
  const csrf = await request.post('/api/auth/login', { headers: { origin: 'https://untrusted.example' }, data: { email: 'test@example.test', password: 'test-password' } });
  expect(csrf.status()).toBe(403);
  const anonymous = await request.get('/api/organizations');
  expect(anonymous.status()).toBe(401);
  expect(JSON.stringify(await anonymous.json())).not.toContain('passwordHash');
});
