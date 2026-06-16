import { chromium } from 'playwright';

const BASE = 'https://isb-beta.vercel.app';
const STATE_FILE = '/tmp/auth_state_manager.json';

const browser = await chromium.launch({ headless: true, slowMo: 200 });
const context = await browser.newContext();
const page = await context.newPage();
await page.setViewportSize({ width: 1440, height: 900 });

const errors = [];
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`[err] ${msg.text()}`); });
page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`));

page.on('response', async (resp) => {
  const url = resp.url();
  if (url.includes('/api/') && (resp.status() >= 400 || url.includes('returns') || url.includes('exchange'))) {
    let body = '';
    try { body = (await resp.text()).slice(0, 500); } catch {}
    console.log(`[${resp.status()}] ${resp.request().method()} ${url.replace(/.*\/api\/v1/, '/api/v1')}`);
    if (body) console.log('  BODY:', body);
  }
});

// Login as manager_book
await page.goto(`${BASE}/login`);
await page.waitForTimeout(3000);
await page.locator('input#username').fill('manager_book');
await page.locator('input#password').fill('manager');
await page.locator('button[type="submit"]').first().click();
await page.waitForTimeout(5000);
console.log('After login URL:', page.url());

// Save session
await context.storageState({ path: STATE_FILE });

// Go to Returns page
await page.goto(`${BASE}/store/returns`);
await page.waitForTimeout(4000);
console.log('\n=== /store/returns URL:', page.url());

// Look for error toast
const bodyText = await page.locator('body').innerText().catch(() => '');
console.log('Body text (first 1000 chars):');
console.log(bodyText.slice(0, 1000));

// Check for any toast
const toasts = await page.locator('[role="alert"], .toast, [data-sonner-toast]').allInnerTexts().catch(() => []);
if (toasts.length) {
  console.log('\nToasts:');
  toasts.forEach(t => console.log('  -', t));
}

await page.screenshot({ path: '/tmp/ss_returns_admin.png', fullPage: true });

// Try to click a Refund button if any
const refundBtn = page.locator('button').filter({ hasText: /refund/i }).first();
if (await refundBtn.isVisible().catch(() => false)) {
  console.log('\nClicking Refund button...');
  await refundBtn.click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/tmp/ss_refund_clicked.png', fullPage: true });
  const bodyText2 = await page.locator('body').innerText().catch(() => '');
  console.log('After refund click body (first 500):');
  console.log(bodyText2.slice(0, 500));
}

if (errors.length) {
  console.log('\n=== JS ERRORS ===');
  errors.forEach(e => console.log(e));
}

await browser.close();
