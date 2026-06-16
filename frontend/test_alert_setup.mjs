import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

await page.goto('https://isb-beta.vercel.app/login');
await page.waitForTimeout(3000);
await page.locator('input#username').fill('somchair');
await page.locator('input#password').fill('parent');
await page.locator('button[type="submit"]').first().click();
await page.waitForTimeout(5000);
console.log('URL after login:', page.url());

// Get children list
const children = await page.evaluate(async () => {
  const tok = localStorage.getItem('access_token');
  const r = await fetch('https://isb-production.up.railway.app/api/v1/family/me', {
    headers: { 'Authorization': 'Bearer ' + tok }
  });
  return { status: r.status, body: await r.json() };
});
console.log('Children:', JSON.stringify(children.body, null, 2).slice(0, 500));

// Test the new low-balance-alert endpoint
if (children.body && children.body.length > 0) {
  const childId = children.body[0].customer_id;
  console.log('\nTesting low-balance-alert endpoint for childId=', childId);
  
  const get1 = await page.evaluate(async (cid) => {
    const tok = localStorage.getItem('access_token');
    const r = await fetch(`https://isb-production.up.railway.app/api/v1/family/me/children/${cid}/low-balance-alert`, {
      headers: { 'Authorization': 'Bearer ' + tok }
    });
    return { status: r.status, body: await r.text() };
  }, childId);
  console.log('GET initial:', get1.status, get1.body);

  const put1 = await page.evaluate(async (cid) => {
    const tok = localStorage.getItem('access_token');
    const r = await fetch(`https://isb-production.up.railway.app/api/v1/family/me/children/${cid}/low-balance-alert`, {
      method: 'PUT',
      headers: { 'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, threshold: 99999 })
    });
    return { status: r.status, body: await r.text() };
  }, childId);
  console.log('PUT enable+threshold:', put1.status, put1.body);
}

await browser.close();
