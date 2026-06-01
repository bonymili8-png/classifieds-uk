// E2E smoke-тести інтерфейсу ОголошенняUK.
// Перевіряють реальні користувацькі сценарії в браузері.
import { test, expect } from '@playwright/test';

const uniqEmail = () => `e2e_${Date.now()}_${Math.floor(Math.random() * 1e4)}@test.dev`;

test('головна показує категорії та свіжі оголошення', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.cat-grid')).toBeVisible();
  // Дочекатися завантаження стрічки (seed-оголошення).
  await expect(page.locator('.card').first()).toBeVisible({ timeout: 10000 });
});

test('пошук фільтрує оголошення', async ({ page }) => {
  await page.goto('/#/search');
  await page.fill('#fQ', 'iPhone');
  // Дебаунс 350мс → дочекатися результату.
  await expect(page.locator('.card-title', { hasText: 'iPhone' }).first()).toBeVisible({ timeout: 10000 });
});

test('відкриття оголошення показує контакти й опис', async ({ page }) => {
  await page.goto('/');
  await page.locator('.card a[href^="#/l/"]').first().click();
  await expect(page.locator('.detail')).toBeVisible();
  await expect(page.locator('.contact-list')).toBeVisible();
  await expect(page.locator('.desc')).toBeVisible();
});

test('перемикання мови UA ↔ EN', async ({ page }) => {
  await page.goto('/#/search');
  await page.click('#langBtn');
  // Після перемикання на EN кнопка показує "UA", а плейсхолдер — англійською.
  await expect(page.locator('#langBtn')).toHaveText('UA');
});

test('реєстрація, створення оголошення з характеристиками, позначення проданим', async ({ page }) => {
  const email = uniqEmail();

  // Реєстрація
  await page.goto('/#/register');
  await page.fill('#aName', 'E2E Тест');
  await page.fill('#aEmail', email);
  await page.fill('#aPass', 'secret123');
  await page.click('#authBtn');
  await expect(page).toHaveURL(/#\/profile/, { timeout: 10000 });

  // Нове оголошення (категорія housing → з'являються характеристики)
  await page.goto('/#/new');
  await page.fill('#title', 'E2E кімната в Лондоні');
  await page.selectOption('#category', 'housing');
  await page.fill('#location', 'London, E1');
  await page.fill('#price', '750');
  await page.fill('#phone', '+447000000123');
  await page.fill('#description', 'Тестова кімната, створена E2E-тестом.');
  // Характеристики мають з'явитися
  await expect(page.locator('#attrSection')).toBeVisible();
  await page.selectOption('#attr_rooms', '2');
  await page.click('#submitBtn');

  // Потрапляємо на сторінку оголошення
  await expect(page.locator('.detail h1')).toHaveText('E2E кімната в Лондоні', { timeout: 10000 });
  // Таблиця характеристик присутня
  await expect(page.locator('.attr-table')).toBeVisible();

  // Позначити проданим (доступно власнику)
  await page.click('#statusBtn');
  await expect(page.locator('.sold-badge')).toBeVisible({ timeout: 10000 });
});

test('збереження оголошення в обране', async ({ page }) => {
  await page.goto('/');
  await page.locator('.card-fav').first().click();
  await page.goto('/#/saved');
  await expect(page.locator('.card').first()).toBeVisible({ timeout: 10000 });
});
