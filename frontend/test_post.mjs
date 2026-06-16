import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('https://isb-beta.vercel.app/login');
await page.waitForTimeout(3000);
await page.locator('input#username').fill('manager_book');
await page.locator('input#password').fill('manager');
await page.locator('button[type="submit"]').first().click();
await page.waitForTimeout(5000);

const result = await page.evaluate(async () => {
  const tok = localStorage.getItem('access_token');
  const r = await fetch('https://isb-production.up.railway.app/api/v1/returns/create', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body: JSON.stringify({ receiptId: 'NONEXISTENT', items: [], reason: 'test' })
  });
  return { status: r.status, body: (await r.text()).slice(0, 3000) };
});
console.log('Status:', result.status);
console.log('Body:', result.body);
await browser.close();
