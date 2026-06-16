import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.join(__dirname, 'qa-screenshots', 'rfid-test');

if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    console.log('1. Navigating to http://localhost:8081...');
    await page.goto('http://localhost:8081', { waitUntil: 'networkidle' });

    // Check if login page is shown
    const loginInput = await page.$('input[type="password"], input[placeholder*="password" i]');
    if (loginInput) {
      console.log('2. Login page detected. Attempting to log in with admin/admin1234...');

      // Try to find username input
      const usernameInputs = await page.$$('input[type="text"], input[placeholder*="user" i], input[placeholder*="name" i]');
      if (usernameInputs.length > 0) {
        await usernameInputs[0].fill('admin');
      }

      // Fill password
      const passwordInputs = await page.$$('input[type="password"]');
      if (passwordInputs.length > 0) {
        await passwordInputs[0].fill('admin1234');
      }

      // Find and click login button
      const buttons = await page.$$('button');
      let loginBtn = null;
      for (const btn of buttons) {
        const text = await btn.textContent();
        if (text && (text.includes('Login') || text.includes('Sign In') || text.includes('เข้าสู่ระบบ'))) {
          loginBtn = btn;
          break;
        }
      }

      if (loginBtn) {
        await loginBtn.click();
        await page.waitForNavigation({ waitUntil: 'networkidle' });
      } else {
        // Try pressing Enter
        await page.keyboard.press('Enter');
        await page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {});
      }
    }

    // Wait a bit for page to load
    await page.waitForTimeout(1000);

    // Navigate to canteen if needed
    const currentUrl = page.url();
    console.log('Current URL:', currentUrl);

    if (!currentUrl.includes('/canteen')) {
      console.log('3. Navigating to /canteen...');
      await page.goto('http://localhost:8081/canteen', { waitUntil: 'networkidle' });
      await page.waitForTimeout(1000);
    }

    // Take screenshot of initial state
    console.log('4. Taking screenshot of initial Canteen state...');
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '1-initial-canteen.png'),
      fullPage: false
    });

    // Click on neutral area (page body) to ensure focus is not on input
    console.log('5. Clicking on page body to set focus...');
    await page.click('body');
    await page.waitForTimeout(200);

    // Test 1: Type RFID code "aaa" rapidly and press Enter
    console.log('6. Simulating RFID input: "aaa" + Enter...');
    await page.keyboard.type('aaa', { delay: 30 });
    await page.keyboard.press('Enter');

    // Wait for toast or member card to appear
    await page.waitForTimeout(2000);

    console.log('7. Taking screenshot after RFID attempt 1 (aaa)...');
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '2-after-rfid-aaa.png'),
      fullPage: false
    });

    // Test 2: Try with username "admin"
    console.log('8. Clicking on page body again...');
    await page.click('body');
    await page.waitForTimeout(200);

    console.log('9. Simulating RFID input: "admin" + Enter...');
    await page.keyboard.type('admin', { delay: 30 });
    await page.keyboard.press('Enter');

    await page.waitForTimeout(2000);

    console.log('10. Taking screenshot after RFID attempt 2 (admin)...');
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '3-after-rfid-admin.png'),
      fullPage: false
    });

    // Test 3: Verify typing in search input does NOT trigger RFID
    console.log('11. Testing that search input does NOT trigger RFID...');

    // Find search input
    const searchInput = await page.$('input[placeholder*="Search" i], input[placeholder*="search" i]');
    if (searchInput) {
      console.log('12. Found search input, clicking it...');
      await searchInput.click();
      await page.waitForTimeout(200);

      console.log('13. Typing "test" in search input...');
      await page.keyboard.type('test', { delay: 30 });

      await page.waitForTimeout(1000);

      console.log('14. Taking screenshot - verify no RFID lookup occurred...');
      await page.screenshot({
        path: path.join(SCREENSHOTS_DIR, '4-search-no-rfid.png'),
        fullPage: false
      });

      // Clear the search
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Delete');
    }

    // Try test "samule"
    console.log('15. Clicking on page body again...');
    await page.click('body');
    await page.waitForTimeout(200);

    console.log('16. Simulating RFID input: "samule" + Enter...');
    await page.keyboard.type('samule', { delay: 30 });
    await page.keyboard.press('Enter');

    await page.waitForTimeout(2000);

    console.log('17. Taking screenshot after RFID attempt 3 (samule)...');
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '5-after-rfid-samule.png'),
      fullPage: false
    });

    console.log('\n✅ All tests completed!');
    console.log('Screenshots saved to:', SCREENSHOTS_DIR);
    console.log('Files:');
    fs.readdirSync(SCREENSHOTS_DIR).forEach(f => {
      console.log(`  - ${f}`);
    });

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await browser.close();
  }
})();
