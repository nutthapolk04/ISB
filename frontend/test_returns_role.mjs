import { chromium } from 'playwright';
import { existsSync } from 'fs';

const BASE = 'https://isb-beta.vercel.app';
const STATE_FILE = '/tmp/auth_state.json';

const browser = await chromium.launch({ headless: false, slowMo: 200 });
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

page.on('response', async (resp) => {
  const url = resp.url();
  if (url.includes('/api/') && (resp.status() >= 400 || url.includes('returns') || url.includes('receipts') || url.includes('exchange'))) {
    let body = '';
    try { body = (await resp.text()).slice(0, 400); } catch {}
    console.log(`[${resp.status()}] ${resp.request().method()} ${url.replace(/.*\/api\/v1/, '/api/v1')}`);
    if (body) console.log('  BODY:', body);
  }
});

// Try select-role page to see what roles available for this user
await page.goto(`${BASE}/select-role`);
await page.waitForTimeout(3000);
console.log('=== /select-role URL:', page.url());
console.log('Body:');
console.log((await page.locator('body').innerText().catch(() => '')).slice(0, 500));

await page.screenshot({ path: '/tmp/ss_role_picker.png', fullPage: true });

await browser.close();
