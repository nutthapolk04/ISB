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

// Extract auth token from localStorage
const token = await page.evaluate(() => {
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    const v = localStorage.getItem(k);
    if (v && v.length > 30 && v.includes('.')) return { k, v: v.slice(0, 60) + '...' };
  }
  return Object.fromEntries(Object.entries(localStorage));
});
console.log('LocalStorage token:', JSON.stringify(token).slice(0, 200));

// Try direct API call with auth
const response = await page.evaluate(async () => {
  const tok = localStorage.getItem('access_token');
  const r = await fetch('https://isb-production.up.railway.app/api/v1/returns', {
    headers: { 'Authorization': 'Bearer ' + tok }
  });
  const txt = await r.text();
  return { status: r.status, body: txt.slice(0, 5000) };
});
console.log('\nDirect API response:');
console.log('Status:', response.status);
console.log('Body:', response.body);

await browser.close();
