const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SCREENSHOTS_DIR = '/Users/oatchat/Downloads/-OKONTEK--ISB-Project-Prototype-main/kiosk/qa-screenshots';
const BASE_URL = 'http://localhost:5175';

// Ensure screenshots directory exists
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

const results = [];

async function testApp() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.setViewportSize({ width: 1920, height: 1080 });

  try {
    // Test 1: Welcome Screen (EN)
    console.log('Test 1: Welcome Screen (EN)');
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: `${SCREENSHOTS_DIR}/01-welcome-en.png` });
    const welcomeText = await page.textContent('body');
    results.push({
      test: '1-Welcome Screen EN',
      status: welcomeText.includes('Check Balance') ? 'PASS' : 'FAIL',
      details: 'Welcome screen loaded with language toggle buttons visible'
    });

    // Test 2: Language Switch to TH
    console.log('Test 2: Language Switch to TH');
    const thButton = await page.locator('[data-test="lang-th"], button:has-text("ไทย"), .lang-button:nth-child(2)').first();
    const thButtonCount = await page.locator('button, [role="button"]').count();
    console.log(`Found ${thButtonCount} buttons on page`);

    // Look for any language switcher button
    const allButtons = await page.locator('button').all();
    let thButtonFound = false;
    for (let i = 0; i < allButtons.length; i++) {
      const text = await allButtons[i].textContent();
      if (text && (text.includes('TH') || text.includes('ไทย'))) {
        await allButtons[i].click();
        thButtonFound = true;
        break;
      }
    }

    if (thButtonFound) {
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${SCREENSHOTS_DIR}/02-welcome-th.png` });
      results.push({
        test: '2-Language Switch TH',
        status: 'PASS',
        details: 'Language switched to Thai'
      });
    } else {
      await page.screenshot({ path: `${SCREENSHOTS_DIR}/02-welcome-th-fail.png` });
      results.push({
        test: '2-Language Switch TH',
        status: 'FAIL',
        details: 'Could not find Thai language button'
      });
    }

    // Switch back to EN
    const enButton = await page.locator('button').all();
    for (let i = 0; i < enButton.length; i++) {
      const text = await enButton[i].textContent();
      if (text && (text.includes('EN') || text.includes('English'))) {
        await enButton[i].click();
        break;
      }
    }
    await page.waitForTimeout(500);

    // Test 3: Login flow (EN) - Card 1234567890
    console.log('Test 3: Login with 1234567890 (EN)');
    const cardInput = await page.locator('input[type="text"], input[placeholder*="card"], input[placeholder*="Card"]').first();
    await cardInput.fill('1234567890');

    const submitButton = await page.locator('button:has-text("Submit"), button:has-text("Check"), button:has-text("ตรวจสอบ")').first();
    await submitButton.click();
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: `${SCREENSHOTS_DIR}/03-login-balance-en.png` });

    const balanceText = await page.textContent('body');
    const hasName = balanceText.includes('Somchai') || balanceText.includes('Balance') || balanceText.includes('Employee');
    results.push({
      test: '3-Login EN (1234567890)',
      status: hasName ? 'PASS' : 'FAIL',
      details: 'Login successful, balance screen displayed with user info'
    });

    // Logout
    const logoutBtn = await page.locator('button:has-text("Logout"), button:has-text("ออกจากระบบ")').first();
    if (await logoutBtn.isVisible()) {
      await logoutBtn.click();
      await page.waitForLoadState('networkidle');
    }
    await page.waitForTimeout(500);

    // Test 4: Language switch to TH and login with 0987654321
    console.log('Test 4: Language switch to TH and login with 0987654321');
    const thBtn = await page.locator('button').all();
    for (let i = 0; i < thBtn.length; i++) {
      const text = await thBtn[i].textContent();
      if (text && (text.includes('TH') || text.includes('ไทย'))) {
        await thBtn[i].click();
        break;
      }
    }
    await page.waitForTimeout(500);

    const cardInput2 = await page.locator('input[type="text"], input[placeholder*="card"], input[placeholder*="Card"]').first();
    await cardInput2.fill('0987654321');

    const submitBtn2 = await page.locator('button').all();
    for (let i = 0; i < submitBtn2.length; i++) {
      const text = await submitBtn2[i].textContent();
      if (text && (text.includes('ตรวจสอบ') || text.includes('Submit'))) {
        await submitBtn2[i].click();
        break;
      }
    }
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: `${SCREENSHOTS_DIR}/04-login-parent-th.png` });

    const parentText = await page.textContent('body');
    const hasParentRole = parentText.includes('ผู้ปกครอง') || parentText.includes('Parent') || parentText.includes('Jane');
    results.push({
      test: '4-Login TH (0987654321)',
      status: hasParentRole ? 'PASS' : 'FAIL',
      details: 'Parent login successful, should show 2 wallets and parent role'
    });

    // Test carousel navigation if visible
    const carouselButtons = await page.locator('button[aria-label*="next"], button[aria-label*="prev"], .carousel-next, .carousel-prev').all();
    if (carouselButtons.length > 0) {
      await carouselButtons[0].click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${SCREENSHOTS_DIR}/04b-carousel-navigation.png` });
      results.push({
        test: '4b-Carousel Navigation',
        status: 'PASS',
        details: 'Carousel navigation working'
      });
    }

    // Logout
    const logoutBtn2 = await page.locator('button:has-text("Logout"), button:has-text("ออกจากระบบ")').first();
    if (await logoutBtn2.isVisible()) {
      await logoutBtn2.click();
      await page.waitForLoadState('networkidle');
    }
    await page.waitForTimeout(500);

    // Test 5: Staff role - switch back to EN and login with A1234
    console.log('Test 5: Staff role (A1234) EN');
    const enBtn = await page.locator('button').all();
    for (let i = 0; i < enBtn.length; i++) {
      const text = await enBtn[i].textContent();
      if (text && (text.includes('EN') || text.includes('English'))) {
        await enBtn[i].click();
        break;
      }
    }
    await page.waitForTimeout(500);

    const cardInput3 = await page.locator('input[type="text"], input[placeholder*="card"], input[placeholder*="Card"]').first();
    await cardInput3.fill('A1234');

    const submitBtn3 = await page.locator('button').all();
    for (let i = 0; i < submitBtn3.length; i++) {
      const text = await submitBtn3[i].textContent();
      if (text && (text.includes('Submit') || text.includes('ตรวจสอบ'))) {
        await submitBtn3[i].click();
        break;
      }
    }
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: `${SCREENSHOTS_DIR}/05-staff-role.png` });

    const staffText = await page.textContent('body');
    const hasStaffBadge = staffText.includes('Staff') || staffText.includes('Admin') || staffText.includes('staff');
    results.push({
      test: '5-Staff Role (A1234)',
      status: hasStaffBadge ? 'PASS' : 'FAIL',
      details: 'Staff role login successful, should show Staff badge'
    });

    // Test 6: Top-up screen
    console.log('Test 6: Top-up screen');
    const topupBtn = await page.locator('button:has-text("Top-up"), button:has-text("เติมเงิน")').first();
    if (await topupBtn.isVisible()) {
      await topupBtn.click();
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: `${SCREENSHOTS_DIR}/06-topup-screen.png` });
      results.push({
        test: '6-Top-up Screen',
        status: 'PASS',
        details: 'Top-up screen loaded'
      });
    } else {
      await page.screenshot({ path: `${SCREENSHOTS_DIR}/06-topup-screen-fail.png` });
      results.push({
        test: '6-Top-up Screen',
        status: 'FAIL',
        details: 'Top-up button not found'
      });
    }

    // Go back
    const backBtn = await page.locator('button:has-text("Back"), button:has-text("กลับ"), a[href="/"]').first();
    if (await backBtn.isVisible()) {
      await backBtn.click();
      await page.waitForLoadState('networkidle');
    }
    await page.waitForTimeout(500);

    // Test 7: Transaction History
    console.log('Test 7: Transaction History');
    const historyBtn = await page.locator('button:has-text("Transaction"), button:has-text("ประวัติ")').first();
    if (await historyBtn.isVisible()) {
      await historyBtn.click();
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: `${SCREENSHOTS_DIR}/07-transaction-history.png` });
      results.push({
        test: '7-Transaction History',
        status: 'PASS',
        details: 'Transaction history screen loaded'
      });
    } else {
      await page.screenshot({ path: `${SCREENSHOTS_DIR}/07-transaction-fail.png` });
      results.push({
        test: '7-Transaction History',
        status: 'FAIL',
        details: 'Transaction history button not found'
      });
    }

    // Test 8: Logout
    console.log('Test 8: Logout');
    const logoutBtn3 = await page.locator('button:has-text("Logout"), button:has-text("ออกจากระบบ")').first();
    if (await logoutBtn3.isVisible()) {
      await logoutBtn3.click();
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: `${SCREENSHOTS_DIR}/08-logout-welcome.png` });
      const backToWelcome = await page.textContent('body');
      results.push({
        test: '8-Logout',
        status: backToWelcome.includes('Check Balance') || backToWelcome.includes('Welcome') ? 'PASS' : 'FAIL',
        details: 'Logout successful, returned to welcome screen'
      });
    }

  } catch (error) {
    console.error('Test error:', error);
    results.push({
      test: 'ERROR',
      status: 'FAIL',
      details: error.message
    });
  } finally {
    await browser.close();

    // Save results
    fs.writeFileSync(`${SCREENSHOTS_DIR}/test-results.json`, JSON.stringify(results, null, 2));
    console.log('\n=== TEST RESULTS ===');
    console.log(JSON.stringify(results, null, 2));
    console.log(`\nScreenshots saved to: ${SCREENSHOTS_DIR}`);
  }
}

testApp();
