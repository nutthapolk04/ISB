import { chromium } from 'playwright';
import { existsSync } from 'fs';

const BASE = 'https://isb-beta.vercel.app';
const SS = '/tmp';
const STATE_FILE = '/tmp/auth_state.json';

const browser = await chromium.launch({ headless: false, slowMo: 400 });
const context = existsSync(STATE_FILE)
  ? await browser.newContext({ storageState: STATE_FILE })
  : await browser.newContext();
const page = await context.newPage();
await page.setViewportSize({ width: 1280, height: 900 });

// Log API responses
page.on('response', async (resp) => {
  const url = resp.url();
  if (url.includes('/api/')) {
    try {
      const body = await resp.json();
      console.log(`[${resp.status()}] ${resp.request().method()} ${url.replace(/.*\/api\/v1/, '/api/v1')}`);
      if (url.includes('/topup')) console.log('  BODY:', JSON.stringify(body));
    } catch {}
  }
});

// Navigate to wallet
await page.goto(`${BASE}/parent/wallet/own`);
await page.waitForTimeout(3000);

if (page.url().includes('/login')) {
  const googleBtn = page.getByRole('button', { name: /sign in with google/i });
  await googleBtn.waitFor({ state: 'visible', timeout: 10000 });
  await googleBtn.click();
  await page.waitForURL((url) => !url.toString().includes('/login'), { timeout: 90_000 });
  await context.storageState({ path: STATE_FILE });
  await page.goto(`${BASE}/parent/wallet/own`);
  await page.waitForTimeout(3000);
}

// Top Up tab → Credit/Debit → 500
const topupTab = page.locator('button').filter({ hasText: /^top.?up$/i }).first();
if (await topupTab.isVisible()) { await topupTab.click(); await page.waitForTimeout(600); }
await page.locator('button').filter({ hasText: /credit/i }).first().click();
await page.waitForTimeout(400);
const amtInput = page.locator('input[type="number"]').first();
await amtInput.click({ clickCount: 3 });
await amtInput.fill('500');
await page.waitForTimeout(300);

// Click Top Up
await page.getByRole('button', { name: /^top.?up$/i }).last().click();
console.log('Clicked Top Up — watching navigation...');

// Watch for BAY redirect
try {
  await page.waitForURL((url) => url.toString().includes('krungsri') || url.toString().includes('easypay'), { timeout: 10000 });
  console.log('Navigated to BAY:', page.url());
} catch {
  console.log('No BAY redirect — URL:', page.url());
}

await page.waitForTimeout(6000);
await page.screenshot({ path: `${SS}/ss_BAY_result.png`, fullPage: true });

const title = await page.title();
const bodyText = await page.locator('body').innerText().catch(() => 'n/a');
const bodyHTML = await page.locator('body').innerHTML().catch(() => 'n/a');
console.log('Page title:', title);
console.log('Body text:', bodyText.slice(0, 500));
console.log('Body HTML (first 500):', bodyHTML.slice(0, 500));
console.log('Final URL:', page.url());

await browser.close();
console.log('Done');
