#!/usr/bin/env node
// Usage: node scripts/screenshot.mjs <out.png> [--url http://localhost:5173] [--w 1600] [--h 1000]
//        [--wait 4000] [--eval "js run in page before capture"] [--theme dark]
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

const args = process.argv.slice(2);
const out = args[0] ?? 'screenshot.png';
const opt = (name, d) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : d;
};
const url = opt('url', 'http://localhost:5173');
const w = Number(opt('w', 1600));
const h = Number(opt('h', 1000));
const wait = Number(opt('wait', 5000));
const evals = args.flatMap((a, i) => (a === '--eval' ? [args[i + 1]] : []));
const theme = opt('theme', null);

const executablePath = ['/opt/pw-browsers/chromium/chrome-linux/chrome', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(existsSync);
const browser = await chromium.launch({
  executablePath,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
if (theme) await page.addInitScript((t) => localStorage.setItem('trackliv:theme', t), theme);
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__trackliv?.getMap?.()?.loaded?.(), null, { timeout: 45000 }).catch(() => {});
await page.waitForTimeout(1500);
for (const js of evals) {
  await page.evaluate(js).catch((e) => logs.push(`[eval error] ${e.message}`));
  await page.waitForTimeout(800);
}
await page.waitForTimeout(wait);
await page.screenshot({ path: out });
await browser.close();
const interesting = logs.filter((l) => !/Download the React DevTools|\[vite\]/.test(l));
if (interesting.length) console.log(interesting.slice(0, 30).join('\n'));
console.log(`saved ${out}`);
