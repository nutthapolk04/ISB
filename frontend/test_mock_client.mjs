import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true, slowMo: 300 });
const page = await browser.newPage();

await page.goto('http://localhost:3001');
await page.waitForTimeout(1000);

// Click EASYPay tab
const easypayTab = page.locator('button#tab-easypay');
await easypayTab.click();
await page.waitForTimeout(500);

// Fill orderRef and amount
await page.locator('#ep-amount').fill('200');
await page.locator('#ep-orderRef').fill('TEST-MC-' + Date.now());

// Click Generate / Submit
const btn = page.locator('button').filter({ hasText: /generate|pay|submit/i }).last();
await btn.click();
console.log('Clicked EASYPay submit');

// Wait for navigation to BAY
try {
  await page.waitForURL((url) => url.toString().includes('krungsri') || url.toString().includes('easypay'), { timeout: 15000 });
  console.log('At URL:', page.url());
} catch {
  console.log('No redirect — URL:', page.url());
}

await page.waitForTimeout(3000);
const html = await page.content();
console.log('=== FIRST 2000 CHARS ===');
console.log(html.slice(0, 2000));

await browser.close();
