import { chromium } from 'playwright';
import { existsSync } from 'fs';
import { writeFileSync } from 'fs';

const BASE = 'https://isb-beta.vercel.app';
const STATE_FILE = '/tmp/auth_state.json';

const browser = await chromium.launch({ headless: true, slowMo: 200 });
const context = existsSync(STATE_FILE)
  ? await browser.newContext({ storageState: STATE_FILE })
  : await browser.newContext();
const page = await context.newPage();
await page.setViewportSize({ width: 1280, height: 900 });

// Capture all requests/responses to BAY
page.on('response', async (resp) => {
  const url = resp.url();
  if (url.includes('/api/') && url.includes('topup')) {
    try {
      const body = await resp.json();
      console.log('TOPUP RESPONSE:', JSON.stringify(body, null, 2));
    } catch {}
  }
});

// Intercept the form submission to inspect what's being posted to BAY
let capturedFormData = null;
page.on('request', async (req) => {
  if (req.url().includes('krungsri') || req.url().includes('easypay')) {
    console.log('BAY REQUEST:', req.method(), req.url());
    console.log('POST data:', req.postData());
    capturedFormData = req.postData();
  }
});

await page.goto(`${BASE}/parent/wallet/own`);
await page.waitForTimeout(3000);

if (page.url().includes('/login')) {
  console.log('Need login');
  await browser.close();
  process.exit(1);
}

// Top Up → Credit/Debit → 500
const topupTab = page.locator('button').filter({ hasText: /^top.?up$/i }).first();
if (await topupTab.isVisible()) { await topupTab.click(); await page.waitForTimeout(600); }
await page.locator('button').filter({ hasText: /credit/i }).first().click();
await page.waitForTimeout(400);
const amtInput = page.locator('input[type="number"]').first();
await amtInput.click({ clickCount: 3 });
await amtInput.fill('500');
await page.waitForTimeout(300);

await page.getByRole('button', { name: /^top.?up$/i }).last().click();
console.log('Clicked Top Up');

// Wait for BAY navigation
try {
  await page.waitForURL((url) => url.toString().includes('krungsri') || url.toString().includes('easypay'), { timeout: 15000 });
  console.log('At BAY URL:', page.url());
} catch {
  console.log('No BAY redirect — URL:', page.url());
}

await page.waitForTimeout(3000);

// Get full page content
const html = await page.content();
console.log('\n=== FULL PAGE HTML ===');
console.log(html.slice(0, 3000));
writeFileSync('/tmp/bay_error_page.html', html);
console.log('\n(Full HTML saved to /tmp/bay_error_page.html)');

const bodyText = await page.locator('body').innerText().catch(() => 'n/a');
console.log('\nBody text:', bodyText);

await browser.close();
