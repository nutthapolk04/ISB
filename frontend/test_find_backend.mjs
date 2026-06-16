import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const apis = new Set();
page.on('request', (req) => {
  if (req.url().includes('/api/v1')) apis.add(new URL(req.url()).origin);
});

await page.goto('https://isb-beta.vercel.app/login');
await page.waitForTimeout(3000);
await page.locator('input#username').fill('manager_book');
await page.locator('input#password').fill('manager');
await page.locator('button[type="submit"]').first().click();
await page.waitForTimeout(5000);

console.log('Backend URLs:', [...apis]);
await browser.close();
