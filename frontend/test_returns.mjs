import { chromium } from 'playwright';
import { existsSync } from 'fs';

const BASE = 'https://isb-beta.vercel.app';
const STATE_FILE = '/tmp/auth_state.json';

const browser = await chromium.launch({ headless: true, slowMo: 200 });
const context = existsSync(STATE_FILE)
  ? await browser.newContext({ storageState: STATE_FILE })
  : await browser.newContext();
const page = await context.newPage();
await page.setViewportSize({ width: 1440, height: 900 });

const errors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`[console.error] ${msg.text()}`);
});
page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`));

// Log API responses
page.on('response', async (resp) => {
  const url = resp.url();
  if (url.includes('/api/') && (resp.status() >= 400 || url.includes('returns') || url.includes('receipts') || url.includes('exchange'))) {
    let body = '';
    try { body = (await resp.text()).slice(0, 300); } catch {}
    console.log(`[${resp.status()}] ${resp.request().method()} ${url.replace(/.*\/api\/v1/, '/api/v1')}`);
    if (body) console.log('  BODY:', body);
  }
});

// Try Returns page
await page.goto(`${BASE}/returns`);
await page.waitForTimeout(4000);
console.log('\n=== /returns URL:', page.url());
await page.screenshot({ path: '/tmp/ss_returns.png', fullPage: true });

// Get visible text
const text1 = await page.locator('body').innerText().catch(() => '');
console.log('Body text (first 800 chars):');
console.log(text1.slice(0, 800));

// Try ReturnHistory page
await page.goto(`${BASE}/return-history`);
await page.waitForTimeout(3000);
console.log('\n=== /return-history URL:', page.url());
await page.screenshot({ path: '/tmp/ss_return_history.png', fullPage: true });

const text2 = await page.locator('body').innerText().catch(() => '');
console.log('Body text (first 500 chars):');
console.log(text2.slice(0, 500));

if (errors.length) {
  console.log('\n=== JS ERRORS ===');
  errors.forEach(e => console.log(e));
}

await browser.close();
