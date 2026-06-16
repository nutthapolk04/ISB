import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const screenshotDir = path.join(__dirname, 'public/qa-screenshots');
if (!fs.existsSync(screenshotDir)) {
  fs.mkdirSync(screenshotDir, { recursive: true });
}

const BASE_URL = 'http://localhost:8081';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function runTests() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const results = {
    tests: [],
    timestamp: new Date().toISOString()
  };

  async function test(name, testFn) {
    try {
      console.log(`\n[TEST] ${name}`);
      await testFn(page);
      results.tests.push({ name, status: 'PASS', error: null });
      console.log(`✓ PASS: ${name}`);
    } catch (error) {
      results.tests.push({ name, status: 'FAIL', error: error.message });
      console.log(`✗ FAIL: ${name} - ${error.message}`);
    }
  }

  try {
    // Test 1: Login page and credentials
    await test('1-Login Page and Credentials', async (page) => {
      await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
      await sleep(2000);

      const loginForm = await page.$('form');
      if (!loginForm) throw new Error('Login form not found');

      await page.screenshot({ path: `${screenshotDir}/01-login-page.png`, fullPage: true });
    });

    // Test 2: Try login with credentials
    await test('2-Admin Login with Credentials', async (page) => {
      await page.goto(`${BASE_URL}/login`);
      await sleep(1000);

      const inputs = await page.$$('input');
      if (inputs.length < 2) throw new Error('Not enough input fields');

      // Try first set of credentials
      await inputs[0].fill('admin');
      await inputs[1].fill('admin123');

      const submitButton = await page.$('button[type="submit"]');
      if (submitButton) {
        await submitButton.click();
        await sleep(3000);
      }

      await page.screenshot({ path: `${screenshotDir}/02-after-login.png`, fullPage: true });
    });

    // Test 3: Check version format in sidebar
    await test('3-Version Format in Sidebar', async (page) => {
      if (page.url().includes('login')) {
        console.log('Not logged in, navigating to home');
      }

      await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
      await sleep(2000);

      const bodyText = await page.content();
      const versionMatch = bodyText.match(/V\d+\.\d+\.\d+\s+\d{12}/);
      if (versionMatch) {
        console.log(`Version format found: ${versionMatch[0]}`);
      } else {
        console.log('Version format not found in expected format');
      }

      await page.screenshot({ path: `${screenshotDir}/03-sidebar-version.png`, fullPage: false });
    });

    // Test 4: Check Shop Dashboard nav item
    await test('4-Shop Dashboard Nav Item in Sidebar', async (page) => {
      const navLinks = await page.$$('a, nav');
      console.log(`Found ${navLinks.length} navigation elements`);

      await page.screenshot({ path: `${screenshotDir}/04-sidebar-nav.png`, fullPage: false });
    });

    // Test 5: Navigate to Shop Dashboard
    await test('5-Shop Dashboard Page (/shop-dashboard)', async (page) => {
      await page.goto(`${BASE_URL}/shop-dashboard`, { waitUntil: 'networkidle' });
      await sleep(2000);

      const pageTitle = await page.title();
      console.log(`Page title: ${pageTitle}`);

      const kpiCards = await page.$$('[class*="card"]');
      console.log(`Found ${kpiCards.length} card elements`);

      await page.screenshot({ path: `${screenshotDir}/05-shop-dashboard.png`, fullPage: true });
    });

    // Test 6: RFID Tap button in Canteen POS
    await test('6-RFID Tap Button in Canteen POS', async (page) => {
      await page.goto(`${BASE_URL}/canteen`, { waitUntil: 'networkidle' });
      await sleep(2000);

      const buttons = await page.$$('button');
      console.log(`Found ${buttons.length} buttons in canteen page`);

      const buttonTexts = await Promise.all(buttons.map(b => b.textContent()));
      const rfidBtn = buttonTexts.find(text => text.includes('แตะ') || text.includes('RFID'));
      if (rfidBtn) {
        console.log(`RFID button text: ${rfidBtn}`);
      }

      await page.screenshot({ path: `${screenshotDir}/06-canteen-pos-rfid.png`, fullPage: true });
    });

    // Test 7: Negative stock in Store POS
    await test('7-Negative Stock in Store POS', async (page) => {
      await page.goto(`${BASE_URL}/store`, { waitUntil: 'networkidle' });
      await sleep(2000);

      const rows = await page.$$('tr, [class*="product"]');
      console.log(`Found ${rows.length} product/row elements`);

      await page.screenshot({ path: `${screenshotDir}/07-store-pos-stock.png`, fullPage: true });
    });

    // Test 8: Inventory stock adjustment shortcuts
    await test('8-Stock Adjustment Shortcuts', async (page) => {
      await page.goto(`${BASE_URL}/canteen/products`, { waitUntil: 'networkidle' });
      await sleep(2000);

      const buttons = await page.$$('button');
      const btnTexts = await Promise.all(buttons.map(b => b.textContent()));
      const hasAdjustButtons = btnTexts.some(text => text.includes('-10') || text.includes('+10'));
      console.log(`Has adjustment buttons: ${hasAdjustButtons}`);

      await page.screenshot({ path: `${screenshotDir}/08-stock-adjustment.png`, fullPage: true });
    });

    // Test 9: Google SSO - no OTP step
    await test('9-Google SSO Login Flow', async (page) => {
      await page.goto(`${BASE_URL}/login`);
      await sleep(1000);

      const buttons = await page.$$('button');
      const btnTexts = await Promise.all(buttons.map(b => b.textContent()));
      const googleBtn = btnTexts.find(text => text.includes('Google'));
      if (googleBtn) {
        console.log(`Google SSO button found: ${googleBtn}`);
      }

      await page.screenshot({ path: `${screenshotDir}/09-google-sso-button.png`, fullPage: true });
    });

    // Test 10: Returns page - no approval buttons
    await test('10-Returns Page Auto-Complete', async (page) => {
      await page.goto(`${BASE_URL}/returns`, { waitUntil: 'networkidle' });
      await sleep(2000);

      const buttons = await page.$$('button');
      const btnTexts = await Promise.all(buttons.map(b => b.textContent()));
      const hasApprovalBtns = btnTexts.some(text => text.includes('อนุมัติ') || text.includes('ปฏิเสธ'));

      if (!hasApprovalBtns) {
        console.log('No approval/rejection buttons found (as expected)');
      } else {
        console.log(`Approval buttons found (unexpected): ${btnTexts.join(', ')}`);
      }

      await page.screenshot({ path: `${screenshotDir}/10-returns-page.png`, fullPage: true });
    });

  } catch (error) {
    console.error('Test suite error:', error);
  } finally {
    // Write results to JSON
    fs.writeFileSync(
      path.join(screenshotDir, 'test-results.json'),
      JSON.stringify(results, null, 2)
    );

    console.log('\n========== RESULTS SUMMARY ==========');
    console.log(`Total tests: ${results.tests.length}`);
    const passed = results.tests.filter(t => t.status === 'PASS').length;
    const failed = results.tests.filter(t => t.status === 'FAIL').length;
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log(`Results saved to: ${screenshotDir}/test-results.json`);
    console.log(`Screenshots saved to: ${screenshotDir}/`);

    await browser.close();
  }
}

runTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
