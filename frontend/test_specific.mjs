import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

await page.goto('https://isb-beta.vercel.app/login');
await page.waitForTimeout(3000);
await page.locator('input#username').fill('manager_book');
await page.locator('input#password').fill('manager');
await page.locator('button[type="submit"]').first().click();
await page.waitForTimeout(5000);

// Test multiple endpoints  
const results = await page.evaluate(async () => {
  const tok = localStorage.getItem('access_token');
  const headers = { 'Authorization': 'Bearer ' + tok };
  const endpoints = [
    'https://isb-production.up.railway.app/api/v1/returns',
    'https://isb-production.up.railway.app/api/v1/return-history',
    'https://isb-production.up.railway.app/api/v1/returns/by-receipt?receiptId=R-20260609-004',
    'https://isb-production.up.railway.app/api/v1/exchange/products?inStock=true',
  ];
  const out = [];
  for (const url of endpoints) {
    try {
      const r = await fetch(url, { headers });
      const txt = await r.text();
      out.push({ url, status: r.status, body: txt.slice(0, 400) });
    } catch (e) { out.push({ url, error: String(e) }); }
  }
  return out;
});

results.forEach(r => {
  console.log('\nURL:', r.url);
  console.log('Status:', r.status, '| Body:', r.body);
});

await browser.close();
