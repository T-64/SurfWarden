/**
 * v0.3 E2E：Options 页渲染与关键分区。
 * 用法：npm run build && node e2e/options.mjs
 */
import path from 'node:path';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright';

try {
  const out = execSync('pgrep -f "e2e-profile" || true').toString().trim();
  if (out) {
    execSync(`kill ${out.split('\n').join(' ')}`);
    await new Promise((r) => setTimeout(r, 1_000));
  }
} catch { /* 忽略 */ }

const pathToExtension = path.resolve('.output/chrome-mv3');
const userDataDir = path.resolve(`.output/e2e-profile-${Date.now()}`);
const ctx = await chromium.launchPersistentContext(userDataDir, {
  channel: 'msedge',
  headless: false,
  args: [
    `--disable-extensions-except=${pathToExtension}`,
    `--load-extension=${pathToExtension}`,
    '--no-first-run',
    '--no-default-browser-check',
  ],
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 20_000 });
const extensionId = sw.url().split('/')[2];

const page = await ctx.newPage();
await page.goto(`chrome-extension://${extensionId}/options.html`);
await page.waitForTimeout(1_500);
const text = await page.locator('body').innerText();

const need = ['隐身', '模板包', '规则', '类别与预算', '学习目标', '行为参数', '数据'];
const missing = need.filter((k) => !text.includes(k));
console.log('[optcheck] sections:', need.filter((k) => text.includes(k)).join(' / '));
if (missing.length > 0) {
  console.error('[optcheck] FAIL, missing sections:', missing.join(', '));
  await ctx.close();
  process.exit(1);
}

// 隐身检测区块应给出可执行的指引（chrome://extensions 链接按钮）
if (!text.includes('允许隐身')) {
  console.error('[optcheck] FAIL: 缺少隐身开启指引');
  await ctx.close();
  process.exit(1);
}

// 模板包导入真实生效：点「社交」后规则表行数应增加
const before = await page.locator('table').first().locator('tbody tr').count();
await page.click('text=导入「社交」');
await page.waitForTimeout(800);
const after = await page.locator('table').first().locator('tbody tr').count();
console.log(`[optcheck] rules rows: ${before} -> ${after}`);
if (after <= before) {
  console.error('[optcheck] FAIL: 模板包导入未增加规则');
  await ctx.close();
  process.exit(1);
}

console.log('[optcheck] PASS');
await ctx.close();
process.exit(0);
