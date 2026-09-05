/**
 * v0.2 E2E 全闭环（U8）：预算 → 引导页 → 豁免 → 放行。
 * 用法：npm run build && node e2e/blocking.mjs
 *
 * 场景配置（通过扩展自身页面写入，模拟用户在 Options 的操作）：
 * - 规则：example.com → entertainment
 * - 类别：entertainment { action: 'budget', budgetMin: 0 }（一有使用即耗尽，最短路径触发封锁）
 * - idleThresholdSec 调大以隔离自动化环境噪声（同 smoke.mjs）
 *
 * 断言链：
 * 1. 首次访问 example.com 正常加载并记账（此时用量 0，尚未封锁）
 * 2. 段闭合后检查点写入 DNR 规则
 * 3. 再次访问 example.com 被重定向到 guide.html?cat=entertainment&url=…
 * 4. 引导页显示该类别统计与"去学习/豁免"动作
 * 5. 点击豁免 → 放行 → 实际落到 https://example.com/
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
await page.bringToFront();

// ---- 配置（等价于 Options 页保存）----
await page.goto(`chrome-extension://${extensionId}/popup.html`);
await page.evaluate(() =>
  chrome.storage.local.set({
    settings: {
      dayCutoffHour: 0,
      idleGraceSec: 60,
      idleThresholdSec: 3600,
      exemptPerDay: 2,
      exemptMinutes: 5,
    },
    categories: [
      { id: 'learning', name: '学习', color: '#16a34a', action: 'track' },
      { id: 'work', name: '工作', color: '#2563eb', action: 'track' },
      { id: 'entertainment', name: '娱乐', color: '#dc2626', budgetMin: 0, action: 'budget' },
      { id: 'neutral', name: '中性', color: '#6b7280', action: 'track' },
    ],
    rules: [
      { id: 'e2e-example', name: 'Example(娱乐)', pattern: 'example.com', category: 'entertainment', enabled: true, createdAt: 1 },
      { id: 'e2e-study', name: 'IANA(中性)', pattern: 'iana.org', category: 'neutral', enabled: true, createdAt: 2 },
    ],
    studyTargets: [
      { id: 't1', name: '德语课 A2', url: 'https://www.iana.org/assignments/utf-8' },
    ],
  }),
);
await page.waitForTimeout(1_500);

// ---- 1. 首次访问：正常加载并记账 ----
await page.goto('https://example.com/', { waitUntil: 'load' });
console.log('[e2e] visit-1 url:', page.url());
if (!page.url().startsWith('https://example.com')) {
  console.error('[e2e] FAIL: 首次访问不应被拦截');
  await ctx.close();
  process.exit(1);
}
await page.waitForTimeout(4_000); // 产生段

// ---- 2. 切走到中性站，触发段闭合与检查点 ----
await page.goto('https://www.iana.org/', { waitUntil: 'load' });
await page.waitForTimeout(2_000);

// ---- 3. 再次访问：应被 DNR 重定向到引导页 ----
await page.goto('https://example.com/', { waitUntil: 'load' });
await page.waitForTimeout(1_500);
const blockedUrl = page.url();
console.log('[e2e] visit-2 url:', blockedUrl);
const redirected = blockedUrl.startsWith(`chrome-extension://${extensionId}/guide.html`);
if (!redirected) {
  console.error('[e2e] FAIL: 第二次访问未被重定向到引导页');
  await ctx.close();
  process.exit(1);
}

// ---- 4. 引导页内容 ----
await page.waitForTimeout(1_000);
const guideText = await page.locator('body').innerText();
console.log('[e2e] guide body head:\n' + guideText.split('\n').slice(0, 8).join('\n'));
const contentOk =
  guideText.includes('娱乐') && guideText.includes('去学习') && guideText.includes('再来');
if (!contentOk) {
  console.error('[e2e] FAIL: 引导页缺少关键内容');
  await ctx.close();
  process.exit(1);
}

// ---- 5. 豁免 → 放行 ----
await page.click('text=再来');
await page.waitForTimeout(4_000);
const afterExempt = page.url();
console.log('[e2e] after-exempt url:', afterExempt);
if (!afterExempt.startsWith('https://example.com')) {
  console.error('[e2e] FAIL: 豁免后未放行到目标站点');
  await ctx.close();
  process.exit(1);
}

console.log('[e2e] PASS：预算→引导页→豁免→放行 全链路通过');
await ctx.close();
process.exit(0);
