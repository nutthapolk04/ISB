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

    // Look for the quick-login button for Cashier
    console.log('2. Looking for Cashier quick-login button...');
    const buttons = await page.$$('button');
    let cashierBtn = null;
    for (const btn of buttons) {
      const text = await btn.textContent();
      if (text && text.includes('Cashier')) {
        cashierBtn = btn;
        break;
      }
    }

    if (cashierBtn) {
      console.log('3. Found Cashier button, clicking it...');
      await cashierBtn.click();
      await page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {});
      await page.waitForTimeout(2000);
    } else {
      console.log('3. Cashier button not found, trying manual login...');
      // Manual login fallback
      await page.fill('input[placeholder="Enter username"]', 'admin');
      await page.fill('input[placeholder="Enter password"]', 'admin1234');
      const signInBtn = await page.$('button:has-text("Sign In")');
      if (signInBtn) {
        await signInBtn.click();
        await page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {});
        await page.waitForTimeout(2000);
      }
    }

    // Navigate to canteen if needed
    const currentUrl = page.url();
    console.log('Current URL:', currentUrl);

    if (!currentUrl.includes('/canteen')) {
      console.log('4. Navigating to /canteen...');
      await page.goto('http://localhost:8081/canteen', { waitUntil: 'networkidle' });
      await page.waitForTimeout(1000);
    }

    // Take screenshot of initial state
    console.log('5. Taking screenshot of initial Canteen state...');
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '1-initial-canteen.png'),
      fullPage: false
    });

    // Click on neutral area (page body) to ensure focus is not on input
    console.log('6. Clicking on page body to set focus...');
    await page.click('body');
    await page.waitForTimeout(200);

    // Test 1: Type RFID code "aaa" rapidly and press Enter
    console.log('7. Simulating RFID input: "aaa" + Enter...');
    await page.keyboard.type('aaa', { delay: 30 });
    await page.keyboard.press('Enter');

    // Wait for toast or member card to appear
    await page.waitForTimeout(2000);

    console.log('8. Taking screenshot after RFID attempt 1 (aaa)...');
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '2-after-rfid-aaa.png'),
      fullPage: false
    });

    // Test 2: Try with username "admin"
    console.log('9. Clicking on page body again...');
    await page.click('body');
    await page.waitForTimeout(200);

    console.log('10. Simulating RFID input: "admin" + Enter...');
    await page.keyboard.type('admin', { delay: 30 });
    await page.keyboard.press('Enter');

    await page.waitForTimeout(2000);

    console.log('11. Taking screenshot after RFID attempt 2 (admin)...');
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '3-after-rfid-admin.png'),
      fullPage: false
    });

    // Test 3: Verify typing in search input does NOT trigger RFID
    console.log('12. Testing that search input does NOT trigger RFID...');

    // Find search input
    const searchInputs = await page.$$('input');
    let searchInput = null;
    for (const input of searchInputs) {
      const placeholder = await input.getAttribute('placeholder');
      if (placeholder && placeholder.toLowerCase().includes('search')) {
        searchInput = input;
        break;
      }
    }

    if (searchInput) {
      console.log('13. Found search input, clicking it...');
      await searchInput.click();
      await page.waitForTimeout(200);

      console.log('14. Typing "test" in search input...');
      await page.keyboard.type('test', { delay: 30 });

      await page.waitForTimeout(1000);

      console.log('15. Taking screenshot - verify no RFID lookup occurred...');
      await page.screenshot({
        path: path.join(SCREENSHOTS_DIR, '4-search-no-rfid.png'),
        fullPage: false
      });

      // Clear the search
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Delete');
    } else {
      console.log('13. Search input not found');
    }

    // Try test "samule"
    console.log('16. Clicking on page body again...');
    await page.click('body');
    await page.waitForTimeout(200);

    console.log('17. Simulating RFID input: "samule" + Enter...');
    await page.keyboard.type('samule', { delay: 30 });
    await page.keyboard.press('Enter');

    await page.waitForTimeout(2000);

    console.log('18. Taking screenshot after RFID attempt 3 (samule)...');
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
