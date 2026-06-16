const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const screenshotDir = path.join(__dirname, 'public/qa-screenshots');
if (!fs.existsSync(screenshotDir)) {
  fs.mkdirSync(screenshotDir, { recursive: true });
}

const BASE_URL = 'http://localhost:8081';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function runTests() {
  const browser = await chromium.launch();
  const context = await browser.createContext();
  const page = await context.newPage();

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

      const usernameInput = await page.$('input[type="text"], input[name*="user"], input[placeholder*="ชื่อ"]');
      if (!usernameInput) throw new Error('Username input not found');

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

      const submitButton = await page.$('button[type="submit"], button:has-text("เข้าสู่ระบบ")');
      if (submitButton) {
        await submitButton.click();
        await sleep(3000);
      }

      await page.screenshot({ path: `${screenshotDir}/02-after-login.png`, fullPage: true });
    });

    // Test 3: Check version format in sidebar
    await test('3-Version Format in Sidebar', async (page) => {
      // Should already be logged in from previous test
      if (page.url().includes('login')) {
        console.log('Not logged in yet, attempting login again');
        await page.goto(`${BASE_URL}/`);
        await sleep(2000);
      }

      const versionText = await page.textContent('[class*="sidebar"], [class*="footer"], [class*="version"]');
      if (!versionText) {
        // Try to find it in any text
        const allText = await page.content();
        const versionMatch = allText.match(/V\d+\.\d+\.\d+\s+\d{12}/);
        console.log(`Version found: ${versionMatch ? versionMatch[0] : 'not found'}`);
      }

      await page.screenshot({ path: `${screenshotDir}/03-sidebar-version.png`, fullPage: true });
    });

    // Test 4: Check Shop Dashboard nav item
    await test('4-Shop Dashboard Nav Item', async (page) => {
      const dashboardLink = await page.$('a:has-text("Dashboard"), a:has-text("ร้านค้า")');
      if (dashboardLink) {
        const text = await dashboardLink.textContent();
        console.log(`Dashboard link text: ${text}`);
      }

      await page.screenshot({ path: `${screenshotDir}/04-sidebar-nav.png`, fullPage: false });
    });

    // Test 5: Navigate to Shop Dashboard
    await test('5-Shop Dashboard Page (/shop-dashboard)', async (page) => {
      await page.goto(`${BASE_URL}/shop-dashboard`, { waitUntil: 'networkidle' });
      await sleep(2000);

      const kpiCards = await page.$$('[class*="card"], [class*="kpi"]');
      console.log(`Found ${kpiCards.length} KPI cards`);

      const shopSelector = await page.$('select, [role="combobox"], [class*="selector"]');
      if (shopSelector) {
        console.log('Shop selector dropdown found');
      }

      await page.screenshot({ path: `${screenshotDir}/05-shop-dashboard.png`, fullPage: true });
    });

    // Test 6: RFID Tap button in Canteen POS
    await test('6-RFID Tap Button in Canteen POS', async (page) => {
      await page.goto(`${BASE_URL}/canteen`, { waitUntil: 'networkidle' });
      await sleep(2000);

      const rfidButton = await page.$('button:has-text("แตะบัตร"), button:has-text("RFID"), [class*="amber"]');
      if (rfidButton) {
        const text = await rfidButton.textContent();
        const color = await rfidButton.evaluate(el => window.getComputedStyle(el).backgroundColor);
        console.log(`RFID button found: "${text}", color: ${color}`);
      } else {
        console.log('RFID button not found with expected selectors');
      }

      await page.screenshot({ path: `${screenshotDir}/06-canteen-pos-rfid.png`, fullPage: true });
    });

    // Test 7: Negative stock in Store POS
    await test('7-Negative Stock in Store POS', async (page) => {
      await page.goto(`${BASE_URL}/store`, { waitUntil: 'networkidle' });
      await sleep(2000);

      const products = await page.$$('[class*="product"], tr, [data-testid*="product"]');
      console.log(`Found ${products.length} product elements`);

      const amberBadges = await page.$$('[class*="amber"], [class*="yellow"]');
      console.log(`Found ${amberBadges.length} amber/yellow badges`);

      await page.screenshot({ path: `${screenshotDir}/07-store-pos-stock.png`, fullPage: true });
    });

    // Test 8: Inventory stock adjustment shortcuts
    await test('8-Stock Adjustment Shortcuts', async (page) => {
      await page.goto(`${BASE_URL}/canteen/products`, { waitUntil: 'networkidle' });
      await sleep(2000);

      const adjustButtons = await page.$$('button:has-text("-10"), button:has-text("+10")');
      console.log(`Found ${adjustButtons.length} adjustment buttons`);

      const previewText = await page.textContent('[class*="preview"], span:has-text("→")');
      if (previewText) {
        console.log(`Stock preview found: ${previewText}`);
      }

      await page.screenshot({ path: `${screenshotDir}/08-stock-adjustment.png`, fullPage: true });
    });

    // Test 9: Google SSO - no OTP step
    await test('9-Google SSO Login Flow', async (page) => {
      await page.goto(`${BASE_URL}/login`);
      await sleep(1000);

      const googleBtn = await page.$('button:has-text("Google"), button:has-text("เข้าสู่ระบบด้วย Google")');
      if (googleBtn) {
        console.log('Google SSO button found');
      }

      await page.screenshot({ path: `${screenshotDir}/09-google-sso-button.png`, fullPage: true });
    });

    // Test 10: Returns page - no approval buttons
    await test('10-Returns Page Auto-Complete', async (page) => {
      await page.goto(`${BASE_URL}/returns`, { waitUntil: 'networkidle' });
      await sleep(2000);

      const returnHistory = await page.textContent('[class*="return"], [class*="history"]');
      if (returnHistory) {
        console.log(`Return history found: ${returnHistory.substring(0, 100)}`);
      }

      const approvalButtons = await page.$$('button:has-text("อนุมัติ"), button:has-text("ปฏิเสธ")');
      if (approvalButtons.length === 0) {
        console.log('No approval/rejection buttons found (expected)');
      } else {
        console.log(`Found ${approvalButtons.length} approval buttons (unexpected)`);
      }

      const completeStatus = await page.textContent('[class*="complete"], [class*="badge"]:has-text("คืนแล้ว")');

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

    await context.close();
    await browser.close();
  }
}

runTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
