import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.join(__dirname, 'qa-screenshots', 'rfid-detailed');

if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

function timestamp() {
  return new Date().toLocaleTimeString();
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  // Enable logging to see what's happening
  const page = await context.newPage();

  // Listen for console messages
  page.on('console', msg => console.log(`[${timestamp()}] Browser console: ${msg.type().toUpperCase()} - ${msg.text()}`));

  try {
    console.log(`[${timestamp()}] Navigating to http://localhost:8081...`);
    await page.goto('http://localhost:8081', { waitUntil: 'networkidle' });

    // Click Cashier button to login
    console.log(`[${timestamp()}] Logging in as Cashier...`);
    const buttons = await page.$$('button');
    for (const btn of buttons) {
      const text = await btn.textContent();
      if (text && text.includes('Cashier')) {
        await btn.click();
        break;
      }
    }
    await page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(2000);

    console.log(`[${timestamp()}] Current URL: ${page.url()}`);

    if (!page.url().includes('/canteen')) {
      console.log(`[${timestamp()}] Navigating to /canteen...`);
      await page.goto('http://localhost:8081/canteen', { waitUntil: 'networkidle' });
    }

    await page.waitForTimeout(1000);

    // Take initial screenshot
    console.log(`[${timestamp()}] Screenshot 1: Initial state`);
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '1-initial.png'),
      fullPage: false
    });

    // ========== TEST 1: RFID with "aaa" ==========
    console.log(`[${timestamp()}] TEST 1: Simulating RFID "aaa"`);

    // Verify focus is on page body, not on input
    const activeElement = await page.evaluate(() => {
      const el = document.activeElement;
      return {
        tagName: el?.tagName,
        id: el?.id,
        class: el?.className
      };
    });
    console.log(`[${timestamp()}] Active element before RFID: ${JSON.stringify(activeElement)}`);

    // Click on page body
    await page.click('body');
    await page.waitForTimeout(200);

    // Type RFID code rapidly (delay < 150ms as per the hook threshold)
    console.log(`[${timestamp()}] Typing 'aaa' with 30ms delay between chars...`);
    await page.keyboard.type('aaa', { delay: 30 });
    console.log(`[${timestamp()}] Pressing Enter...`);
    await page.keyboard.press('Enter');

    await page.waitForTimeout(2500);

    console.log(`[${timestamp()}] Screenshot 2: After RFID "aaa"`);
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '2-after-aaa.png'),
      fullPage: false
    });

    // Check if any toast appeared
    const toastElements = await page.$$('[role="status"], [data-sonner-toast], .toast, .sonner');
    console.log(`[${timestamp()}] Found ${toastElements.length} potential toast elements`);

    // Check search input state
    const searchInputValue = await page.inputValue('input[placeholder*="Search" i]').catch(() => null);
    console.log(`[${timestamp()}] Search input value: "${searchInputValue}"`);

    // ========== TEST 2: RFID with valid member code ==========
    // First, let's try to find a valid member code by checking API
    console.log(`[${timestamp()}] TEST 2: Looking for valid member codes...`);

    // Clear any state
    await page.click('body');
    await page.waitForTimeout(200);

    // Try a different code
    console.log(`[${timestamp()}] Typing 'admin' with 30ms delay...`);
    await page.keyboard.type('admin', { delay: 30 });
    console.log(`[${timestamp()}] Pressing Enter...`);
    await page.keyboard.press('Enter');

    await page.waitForTimeout(2500);

    console.log(`[${timestamp()}] Screenshot 3: After RFID "admin"`);
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '3-after-admin.png'),
      fullPage: false
    });

    // ========== TEST 3: Verify search input isolation ==========
    console.log(`[${timestamp()}] TEST 3: Verify search input does NOT trigger RFID`);

    // Find and click search input
    const searchInput = await page.$('input[placeholder*="Search" i]');
    if (searchInput) {
      console.log(`[${timestamp()}] Found search input, clicking it...`);
      await searchInput.click();
      await page.waitForTimeout(200);

      // Type something in the search
      console.log(`[${timestamp()}] Typing "test" in search with 30ms delay...`);
      await page.keyboard.type('test', { delay: 30 });

      await page.waitForTimeout(1000);

      console.log(`[${timestamp()}] Screenshot 4: After typing in search input`);
      await page.screenshot({
        path: path.join(SCREENSHOTS_DIR, '4-search-input.png'),
        fullPage: false
      });

      // Verify the search shows "test" but doesn't trigger RFID lookup
      const searchValue = await page.inputValue('input[placeholder*="Search" i]');
      console.log(`[${timestamp()}] Search input value after typing: "${searchValue}"`);

      // Clear
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Delete');
    }

    // ========== TEST 4: Slow typing (manual input) ==========
    console.log(`[${timestamp()}] TEST 4: Slow typing should NOT trigger auto-submit`);

    // Click on body
    await page.click('body');
    await page.waitForTimeout(200);

    // Type slowly (>150ms gaps should NOT trigger RFID auto-submit)
    console.log(`[${timestamp()}] Typing 'test' with 200ms delay (slow = manual typing)...`);
    await page.keyboard.type('test', { delay: 200 });

    await page.waitForTimeout(1000);

    console.log(`[${timestamp()}] Screenshot 5: After slow typing`);
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '5-slow-typing.png'),
      fullPage: false
    });

    // Now press Enter to submit the slow typing
    console.log(`[${timestamp()}] Pressing Enter for slow-typed input...`);
    await page.keyboard.press('Enter');

    await page.waitForTimeout(2500);

    console.log(`[${timestamp()}] Screenshot 6: After Enter for slow typing`);
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '6-slow-typing-enter.png'),
      fullPage: false
    });

    console.log(`\n✅ Detailed tests completed!`);
    console.log(`Screenshots saved to: ${SCREENSHOTS_DIR}`);

  } catch (error) {
    console.error(`[${timestamp()}] ❌ Test failed:`, error);
  } finally {
    await browser.close();
  }
})();
