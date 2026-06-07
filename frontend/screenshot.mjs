import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1560, height: 980 } });
await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle', timeout: 15000 });
await page.waitForTimeout(2000);
await page.screenshot({ path: '/tmp/ui-current.png', fullPage: false });
console.log('Screenshot saved to /tmp/ui-current.png');
await browser.close();
