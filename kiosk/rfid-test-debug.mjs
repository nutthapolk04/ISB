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

    // Debug: Take screenshot of login page
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, 'debug-login-page.png'),
      fullPage: true
    });
    console.log('✓ Screenshot of login page saved');

    // Debug: Get all inputs
    const inputs = await page.$$('input');
    console.log(`Found ${inputs.length} input fields`);
    for (let i = 0; i < inputs.length; i++) {
      const type = await inputs[i].getAttribute('type');
      const placeholder = await inputs[i].getAttribute('placeholder');
      const name = await inputs[i].getAttribute('name');
      console.log(`  Input ${i}: type=${type}, placeholder=${placeholder}, name=${name}`);
    }

    // Get all buttons
    const buttons = await page.$$('button');
    console.log(`Found ${buttons.length} buttons`);
    for (let i = 0; i < buttons.length; i++) {
      const text = await buttons[i].textContent();
      console.log(`  Button ${i}: ${text?.trim()}`);
    }

  } catch (error) {
    console.error('❌ Debug failed:', error);
  } finally {
    await browser.close();
  }
})();
