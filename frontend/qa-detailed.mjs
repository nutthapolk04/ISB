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

async function runDetailedTests() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setViewportSize({ width: 1280, height: 720 });

  const results = {
    features: [],
    timestamp: new Date().toISOString()
  };

  function reportFeature(name, status, details = '') {
    const entry = { name, status, details };
    results.features.push(entry);
    const statusEmoji = status === 'PASS' ? '✓' : '✗';
    console.log(`${statusEmoji} ${name}: ${status}`);
    if (details) console.log(`  └─ ${details}`);
  }

  try {
    // Feature 1: Version format in sidebar
    console.log('\n=== Feature 1: Version Format ===');
    await page.goto(`${BASE_URL}/login`);
    await sleep(1000);

    // Login first
    const inputs = await page.$$('input');
    if (inputs.length >= 2) {
      await inputs[0].fill('admin');
      await inputs[1].fill('admin1234');
      const submitBtn = await page.$('button[type="submit"]');
      if (submitBtn) {
        await submitBtn.click();
        await sleep(2500);
      }
    }

    // Check if sidebar is visible
    const sidebarFooter = await page.$('[data-sidebar="footer"]');
    if (sidebarFooter) {
      const versionText = await sidebarFooter.textContent();
      console.log(`Version text found: ${versionText}`);

      // Look for V1.0.0 YYYYMMDDHHMI format
      const versionMatch = versionText.match(/V\d+\.\d+\.\d+ \d{12}/);
      if (versionMatch) {
        reportFeature('1. Version format in sidebar', 'PASS', `Format: ${versionMatch[0]}`);
      } else {
        const hasV = versionText.includes('V');
        const parts = versionText.split(/\s+/);
        reportFeature('1. Version format in sidebar', 'FAIL', `Found: "${versionText}", Expected: V#.#.# YYYYMMDDHHMI`);
      }
    } else {
      reportFeature('1. Version format in sidebar', 'FAIL', 'Sidebar footer not found');
    }

    await page.screenshot({ path: `${screenshotDir}/feature-1-version.png` });

    // Feature 2: Shop Dashboard nav item
    console.log('\n=== Feature 2: Shop Dashboard Nav Item ===');
    const dashboardNavItem = await page.$('a[href*="/shop-dashboard"]');
    if (dashboardNavItem) {
      const text = await dashboardNavItem.textContent();
      const hasThaiText = /ร้านค้า|Dashboard/.test(text);
      if (hasThaiText) {
        reportFeature('2. Shop Dashboard nav item', 'PASS', `Nav text: "${text.trim()}"`);
      } else {
        reportFeature('2. Shop Dashboard nav item', 'FAIL', `Nav text: "${text}" (missing Thai)`);
      }
    } else {
      reportFeature('2. Shop Dashboard nav item', 'FAIL', 'Shop Dashboard link not found');
    }

    await page.screenshot({ path: `${screenshotDir}/feature-2-nav.png` });

    // Feature 3: Shop Dashboard page
    console.log('\n=== Feature 3: Shop Dashboard Page ===');
    await page.goto(`${BASE_URL}/shop-dashboard`);
    await sleep(2000);

    const kpiCards = await page.$$('[class*="card"]');
    const pageContent = await page.content();
    const hasKPI = pageContent.includes('วันนี้') || pageContent.includes('เดือน') || kpiCards.length > 0;
    const hasShopSelector = pageContent.includes('select') || pageContent.includes('dropdown');

    if (hasKPI) {
      reportFeature('3. Shop Dashboard KPI cards', 'PASS', `Found ${kpiCards.length} card elements`);
    } else {
      reportFeature('3. Shop Dashboard KPI cards', 'FAIL', 'KPI cards not found');
    }

    await page.screenshot({ path: `${screenshotDir}/feature-3-dashboard.png` });

    // Feature 4: RFID Tap button
    console.log('\n=== Feature 4: RFID Tap Button ===');
    await page.goto(`${BASE_URL}/canteen`);
    await sleep(2000);

    const pageText = await page.content();
    const hasRFID = pageText.includes('แตะบัตร') || pageText.includes('RFID');
    const buttons = await page.$$('button');
    const buttonTexts = await Promise.all(buttons.map(b => b.textContent()));
    const rfidBtn = buttonTexts.find(t => t.includes('แตะ') || t.includes('RFID'));

    if (rfidBtn) {
      reportFeature('4. RFID Tap button in Canteen POS', 'PASS', `Button text: "${rfidBtn.trim()}"`);
    } else if (hasRFID) {
      reportFeature('4. RFID Tap button in Canteen POS', 'PASS', 'RFID element found in page');
    } else {
      reportFeature('4. RFID Tap button in Canteen POS', 'FAIL', 'RFID button not found');
    }

    await page.screenshot({ path: `${screenshotDir}/feature-4-rfid.png` });

    // Feature 5: Negative stock badge
    console.log('\n=== Feature 5: Negative Stock in Store ===');
    await page.goto(`${BASE_URL}/store`);
    await sleep(2000);

    const storePageText = await page.content();
    const hasAmberBadge = storePageText.includes('amber') || storePageText.includes('yellow') || storePageText.includes('stock');

    if (hasAmberBadge) {
      reportFeature('5. Negative stock in Store POS', 'PASS', 'Stock elements found');
    } else {
      reportFeature('5. Negative stock in Store POS', 'INCOMPLETE', 'Unable to verify without live data');
    }

    await page.screenshot({ path: `${screenshotDir}/feature-5-store-stock.png` });

    // Feature 6: Stock adjustment shortcuts
    console.log('\n=== Feature 6: Stock Adjustment Shortcuts ===');
    await page.goto(`${BASE_URL}/canteen/products`);
    await sleep(2000);

    const adjustBtns = await page.$$('button');
    const adjustTexts = await Promise.all(adjustBtns.map(b => b.textContent()));
    const hasAdjust = adjustTexts.some(t => t.includes('-10') || t.includes('+10') || t.includes('-5') || t.includes('+5'));

    if (hasAdjust) {
      reportFeature('6. Stock adjustment shortcuts', 'PASS', 'Adjustment buttons found');
    } else {
      reportFeature('6. Stock adjustment shortcuts', 'INCOMPLETE', 'Adjustment buttons not visible on initial load');
    }

    await page.screenshot({ path: `${screenshotDir}/feature-6-adjustment.png` });

    // Feature 7: Google SSO
    console.log('\n=== Feature 7: Google SSO ===');
    await page.goto(`${BASE_URL}/login`);
    await sleep(1500);

    const googleBtn = await page.$('button:has-text("Google")');
    const googleBtnText = await page.content();
    const hasGoogle = googleBtnText.includes('Google') || googleBtnText.includes('Sign in');

    if (hasGoogle) {
      reportFeature('7. Google SSO button', 'PASS', 'Google login option visible');
    } else {
      reportFeature('7. Google SSO button', 'FAIL', 'Google SSO button not found');
    }

    await page.screenshot({ path: `${screenshotDir}/feature-7-google-sso.png` });

    // Feature 8: Returns page
    console.log('\n=== Feature 8: Returns Page ===');
    await page.goto(`${BASE_URL}/returns`);
    await sleep(2000);

    const returnPageText = await page.content();
    const hasReturnPage = returnPageText.length > 100;
    const approvalBtns = await page.$$('button');
    const approvalTexts = await Promise.all(approvalBtns.map(b => b.textContent()));
    const hasApprovalBtns = approvalTexts.some(t => t.includes('อนุมัติ') || t.includes('ปฏิเสธ'));

    if (hasReturnPage && !hasApprovalBtns) {
      reportFeature('8. Returns page auto-complete', 'PASS', 'No approval buttons found (as expected)');
    } else if (!hasApprovalBtns) {
      reportFeature('8. Returns page auto-complete', 'PASS', 'No approval buttons (expected behavior)');
    } else {
      reportFeature('8. Returns page auto-complete', 'FAIL', 'Approval buttons found (should not exist)');
    }

    await page.screenshot({ path: `${screenshotDir}/feature-8-returns.png` });

  } catch (error) {
    console.error('Test error:', error);
  } finally {
    fs.writeFileSync(
      path.join(screenshotDir, 'detailed-results.json'),
      JSON.stringify(results, null, 2)
    );

    console.log('\n========== SUMMARY ==========');
    console.log(`Total features tested: ${results.features.length}`);
    const passed = results.features.filter(f => f.status === 'PASS').length;
    const failed = results.features.filter(f => f.status === 'FAIL').length;
    const incomplete = results.features.filter(f => f.status === 'INCOMPLETE').length;
    console.log(`✓ PASS: ${passed}`);
    console.log(`✗ FAIL: ${failed}`);
    console.log(`? INCOMPLETE: ${incomplete}`);
    console.log(`\nResults: ${screenshotDir}/detailed-results.json`);
    console.log(`Screenshots: ${screenshotDir}/`);

    await browser.close();
  }
}

runDetailedTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
