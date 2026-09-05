/**
 * v0.1 真机冒烟（dev-process §3 最后一道闸）。
 * 用法：npm run build && node e2e/smoke.mjs
 *
 * 取证式流程：固定一个常驻的扩展探测页（probe），每步导航后读取
 * storage.session 快照与 IndexedDB 行数，形成状态时间线；同时抓 SW console。
 * 关键环境处理：自动化浏览器没有人类输入 → 先把 idleThresholdSec 调大到 3600。
 */
import path from 'node:path';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright';

try {
  const out = execSync('pgrep -f "e2e-profile" || true').toString().trim();
  if (out) {
    console.log('[smoke] killing stale e2e browser:', out);
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
console.log('[smoke] extension id:', extensionId);
sw.on('console', (m) => console.log('[sw-console]', m.type(), m.text()));
sw.on('close', () => console.log('[smoke] SW CLOSED (suspended or restarted)'));
ctx.on('serviceworker', (w) => console.log('[smoke] SW STARTED:', w.url()));

const readProbe = `async () => {
  const snap = await chrome.storage.session.get(null);
  const rows = await new Promise((resolve) => {
    const open = indexedDB.open("SurfWardenDB");
    open.onsuccess = () => {
      const idb = open.result;
      const tx = idb.transaction("sessions", "readonly");
      const req = tx.objectStore("sessions").getAll();
      req.onsuccess = () => resolve(req.result.map((r) => ({ url: r.url, start: r.start, end: r.end, reason: r.endReason, date: r.date })));
      req.onerror = () => resolve(["idb-error"]);
    };
    open.onerror = () => resolve(["idb-open-error"]);
  });
  return { snapshot: snap.tracker ?? null, sessions: rows };
}`;

// 探测页：常驻 popup.html，不导航
const probe = await ctx.newPage();
await probe.goto(`chrome-extension://${extensionId}/popup.html`);
await probe.waitForTimeout(1_000);

// 浏览页：先经 popup.html 写入 E2E 用配置
const page = await ctx.newPage();
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
  }),
);
await page.waitForTimeout(1_500);
console.log('[smoke][S0 after settings]', JSON.stringify(await probe.evaluate(`(${readProbe})()`)));

await page.goto('https://example.com/', { waitUntil: 'load' });
await page.waitForTimeout(4_000);
console.log('[smoke][S1 example.com]', JSON.stringify(await probe.evaluate(`(${readProbe})()`)));

await page.goto('https://www.iana.org/', { waitUntil: 'load' });
await page.waitForTimeout(4_000);
console.log('[smoke][S2 iana.org]', JSON.stringify(await probe.evaluate(`(${readProbe})()`)));

await page.goto('about:blank');
await page.waitForTimeout(2_000);
console.log('[smoke][S3 about:blank]', JSON.stringify(await probe.evaluate(`(${readProbe})()`)));

// 最终 popup 断言（fresh mount）
const popup = await ctx.newPage();
await popup.goto(`chrome-extension://${extensionId}/popup.html`);
await popup.waitForTimeout(1_500);
const text = await popup.locator('body').innerText();
console.log('[smoke] popup body:\n' + text);

const ok = text.includes('iana.org') || text.includes('example.com');
console.log(ok ? '[smoke] PASS' : '[smoke] FAIL: popup 未出现期望站点');
await ctx.close();
process.exit(ok ? 0 : 1);
