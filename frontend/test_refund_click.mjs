import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

const apiErrors = [];
page.on('response', async (resp) => {
  const url = resp.url();
  if (url.includes('/api/') && resp.status() >= 400) {
    let body = '';
    try { body = (await resp.text()).slice(0, 300); } catch {}
    apiErrors.push(`[${resp.status()}] ${resp.request().method()} ${url.replace(/.*\/api\/v1/, '/api/v1')} → ${body}`);
  }
});

await page.goto('https://isb-beta.vercel.app/login');
await page.waitForTimeout(3000);
await page.locator('input#username').fill('manager_book');
await page.locator('input#password').fill('manager');
await page.locator('button[type="submit"]').first().click();
await page.waitForTimeout(5000);

await page.goto('https://isb-beta.vercel.app/store/returns');
await page.waitForTimeout(4000);

// Click first Refund button
const refundBtn = page.locator('button').filter({ hasText: /^refund$/i }).first();
if (await refundBtn.isVisible().catch(() => false)) {
  console.log('Clicking Refund...');
  await refundBtn.click();
  await page.waitForTimeout(4000);
} else {
  console.log('No Refund button visible');
}

// Click Exchange button  
await page.goto('https://isb-beta.vercel.app/store/returns');
await page.waitForTimeout(3000);
const exchangeBtn = page.locator('button').filter({ hasText: /^exchange$/i }).first();
if (await exchangeBtn.isVisible().catch(() => false)) {
  console.log('Clicking Exchange...');
  await exchangeBtn.click();
  await page.waitForTimeout(4000);
} else {
  console.log('No Exchange button visible');
}

if (apiErrors.length === 0) {
  console.log('\n✓ No API errors after clicking Refund/Exchange');
} else {
  console.log('\nAPI errors:');
  apiErrors.forEach(e => console.log('  -', e));
}

await browser.close();
