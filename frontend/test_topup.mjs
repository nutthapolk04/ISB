import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();
await page.setViewportSize({ width: 1280, height: 800 });

await page.goto('https://isb-beta.vercel.app/parent/wallet/own');
await page.waitForTimeout(3000);
await page.screenshot({ path: '/tmp/ss_01_wallet.png' });
console.log('URL:', page.url());
await browser.close();
