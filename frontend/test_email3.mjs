import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

await page.goto('https://isb-beta.vercel.app/login');
await page.waitForTimeout(2500);
await page.locator('input#username').fill('mari');
await page.locator('input#password').fill('Adminmari0');
await page.locator('button[type="submit"]').first().click();
await page.waitForTimeout(4500);

const result = await page.evaluate(async () => {
  const tok = localStorage.getItem('access_token');
  const r = await fetch('https://isb-production.up.railway.app/api/v1/admin/settings/test-email', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: 'nutthapol.k@okontek.com' })
  });
  return { status: r.status, body: await r.text() };
});
console.log('Status:', result.status);
console.log('Body:', result.body);
await browser.close();
