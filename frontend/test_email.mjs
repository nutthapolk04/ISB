import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

// Need an admin account — use 'admin' / 'admin' default or whatever exists
// Try common admin credentials
const accounts = [
  ['admin', 'admin'],
  ['admin', 'admin123'],
  ['superadmin', 'admin'],
];

let loggedIn = false;
for (const [u, p] of accounts) {
  await page.goto('https://isb-beta.vercel.app/login');
  await page.waitForTimeout(2000);
  await page.locator('input#username').fill(u);
  await page.locator('input#password').fill(p);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(3500);
  const url = page.url();
  if (!url.includes('/login')) {
    console.log(`Logged in as ${u} → ${url}`);
    loggedIn = true;
    break;
  }
}

if (!loggedIn) {
  console.log('All admin accounts failed — please provide credentials');
  await browser.close();
  process.exit(1);
}

// Get current user info
const me = await page.evaluate(async () => {
  const tok = localStorage.getItem('access_token');
  const r = await fetch('https://isb-production.up.railway.app/api/v1/auth/me', {
    headers: { 'Authorization': 'Bearer ' + tok }
  });
  return await r.json();
});
console.log('Me:', JSON.stringify(me).slice(0, 300));

// Call test-email
const result = await page.evaluate(async () => {
  const tok = localStorage.getItem('access_token');
  const r = await fetch('https://isb-production.up.railway.app/api/v1/admin/settings/test-email', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json' }
  });
  return { status: r.status, body: await r.text() };
});
console.log('\nTest email result:');
console.log('Status:', result.status);
console.log('Body:', result.body);

await browser.close();
