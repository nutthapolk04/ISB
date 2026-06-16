import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, slowMo: 200 });
const context = await browser.newContext();
const page = await context.newPage();
await page.setViewportSize({ width: 1440, height: 900 });

const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto('https://isb-beta.vercel.app/login');
await page.waitForTimeout(3000);
await page.locator('input#username').fill('manager_book');
await page.locator('input#password').fill('manager');
await page.locator('button[type="submit"]').first().click();
await page.waitForTimeout(5000);

// Go to Store Management → first shop
await page.goto('https://isb-beta.vercel.app/store/management');
await page.waitForTimeout(3000);
console.log('Management URL:', page.url());

// Click first shop row to enter shop detail
const firstShop = page.locator('a, button').filter({ hasText: /book|shop|store/i }).first();
const shops = await page.locator('table tbody tr, [role="row"]').all();
console.log('Shop rows:', shops.length);

// Take a screenshot first
await page.screenshot({ path: '/tmp/ss_mgmt.png', fullPage: true });
console.log('Body text first 600:');
console.log((await page.locator('body').innerText()).slice(0, 600));

await browser.close();
