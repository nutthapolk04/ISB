import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, slowMo: 150 });
const context = await browser.newContext();
const page = await context.newPage();
await page.setViewportSize({ width: 1440, height: 900 });

await page.goto('https://isb-beta.vercel.app/login');
await page.waitForTimeout(3000);
await page.locator('input#username').fill('manager_book');
await page.locator('input#password').fill('manager');
await page.locator('button[type="submit"]').first().click();
await page.waitForTimeout(5000);

await page.goto('https://isb-beta.vercel.app/store/management/bookstore');
await page.waitForTimeout(3000);

// Click Bundles tab
const bundleTab = page.locator('[role="tab"]').filter({ hasText: /bundle|ชุดสินค้า/i }).first();
if (await bundleTab.isVisible().catch(() => false)) {
  await bundleTab.click();
  await page.waitForTimeout(2000);
  console.log('Clicked Bundles tab');
}

// Click "Create" / "สร้าง" button
const createBtn = page.locator('button').filter({ hasText: /create|สร้าง.*ชุด|new.*bundle/i }).first();
if (await createBtn.isVisible().catch(() => false)) {
  await createBtn.click();
  await page.waitForTimeout(1500);
  console.log('Opened create dialog');
}

await page.screenshot({ path: '/tmp/ss_bundle_open.png', fullPage: true });

// Check if dialog is open
const dialog = page.locator('[role="dialog"]');
console.log('Dialog open:', await dialog.isVisible().catch(() => false));

// Need to fill bundle code + name first (required fields)
const codeInput = page.locator('input').nth(0);
await codeInput.fill('TEST-BUNDLE-1');
const nameInput = page.locator('input').nth(1);
await nameInput.fill('Test Bundle');
await page.waitForTimeout(500);

// Dump all input placeholders in dialog
const placeholders = await page.locator('[role="dialog"] input').evaluateAll(els => els.map(e => ({ ph: e.placeholder, type: e.type })));
console.log('Inputs in dialog:', JSON.stringify(placeholders));

// Search a product — use placeholder match
const searchInput = page.locator('input[placeholder*="Search by code"]');
await searchInput.fill('BK001', { timeout: 5000 }).catch(e => console.log('Fill fail:', e.message));
await page.waitForTimeout(2000);
await page.screenshot({ path: '/tmp/ss_bundle_search.png', fullPage: true });

// Click first product result
const productRow = page.locator('[role="dialog"] div').filter({ hasText: /BK001|stock/i }).filter({ hasNotText: /search/i }).first();
const clickable = await page.locator('[role="dialog"] .cursor-pointer').first();
if (await clickable.isVisible().catch(() => false)) {
  await clickable.click();
  await page.waitForTimeout(800);
  console.log('Clicked first product (1st time)');
  await page.screenshot({ path: '/tmp/ss_bundle_added_once.png', fullPage: true });
  console.log('Dialog still open after 1st add:', await dialog.isVisible().catch(() => false));

  // Search same product again
  await searchInput.fill('');
  await searchInput.fill('BK001');
  await page.waitForTimeout(2000);

  // Click same product again
  const clickable2 = await page.locator('[role="dialog"] .cursor-pointer').first();
  if (await clickable2.isVisible().catch(() => false)) {
    await clickable2.click();
    await page.waitForTimeout(2000);
    console.log('Clicked SAME product (2nd time)');
    await page.screenshot({ path: '/tmp/ss_bundle_dup.png', fullPage: true });
    console.log('Dialog still open after 2nd (dup) add:', await dialog.isVisible().catch(() => false));

    // Check for toast
    const toasts = await page.locator('[data-sonner-toast], [role="status"]').allInnerTexts().catch(() => []);
    console.log('Toasts:', toasts);
  } else {
    console.log('No product clickable on 2nd search');
  }
}

await browser.close();
