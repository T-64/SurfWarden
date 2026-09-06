/**
 * UI 截图工具：加载构建产物，为 popup / options / guide / dashboard 截图到 docs/images/。
 * 用法：npm run build && node e2e/shoot.mjs [前缀]
 * 例：node e2e/shoot.mjs baseline-  → docs/images/baseline-popup.png
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url)); // e2e/
const PROJ = path.resolve(HERE, '..'); // 项目根，与 cwd 无关

const PREFIX = process.argv[2] ?? '';

try {
  const out = execSync('pgrep -f "e2e-profile" || true').toString().trim();
  if (out) {
    execSync(`kill ${out.split('\n').join(' ')}`);
    await new Promise((r) => setTimeout(r, 1_000));
  }
} catch { /* 忽略 */ }

const pathToExtension = path.join(PROJ, '.output/chrome-mv3');
const userDataDir = path.join(PROJ, `.output/e2e-profile-${Date.now()}`);
const outDir = path.join(PROJ, 'docs/images');
execSync(`mkdir -p "${outDir}"`);

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

/** 给扩展预置一点演示数据，让截图有真实感 */
async function seedDemoData() {
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.evaluate(async () => {
    const { dateKey } = await import(chrome.runtime.getURL('shared/datetime.js')).catch(() => ({}));
    void dateKey;
    // 直接操作 IndexedDB 写入今日演示用量
    function put(db, store, value) {
      return new Promise((res, rej) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(value);
        tx.oncomplete = res;
        tx.onerror = rej;
      });
    }
    const db = await new Promise((res, rej) => {
      const o = indexedDB.open('SurfWardenDB');
      o.onsuccess = () => res(o.result);
      o.onerror = rej;
    });
    const today = new Date();
    const key = (offsetDays) => {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offsetDays);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    // 7 天历史（第 3 天无学习 → 演示 streak 断点前的连续；今日另外叠加明细行）
    const rows = [];
    const hist = [
      { learning: 1800, entertainment: 3600, work: 7200 },
      { learning: 2400, entertainment: 1800, work: 6600 },
      { learning: 0, entertainment: 4500, work: 5400 },
      { learning: 3000, entertainment: 900, work: 7800 },
      { learning: 2700, entertainment: 3000, work: 6000 },
      { learning: 3600, entertainment: 2700, work: 7200 },
      { learning: 1200, entertainment: 4200, work: 4800 },
    ];
    hist.forEach((h, i) => {
      const d = key(6 - i);
      if (h.learning) rows.push({ date: d, categoryId: 'learning', host: 'www.bilibili.com', seconds: h.learning, visits: 3 });
      if (h.entertainment) rows.push({ date: d, categoryId: 'entertainment', host: 'twitter.com', seconds: h.entertainment, visits: 6 });
      if (h.work) rows.push({ date: d, categoryId: 'work', host: 'github.com', seconds: h.work, visits: 9 });
    });
    rows.push(
      { date: key(0), categoryId: 'neutral', host: 'www.google.com', seconds: 360, visits: 6 },
      { date: key(0), categoryId: 'neutral', host: 'stackoverflow.com', seconds: 900, visits: 3 },
    );
    // 今日 sessions（小时分布图数据源）：9/10/14/15/20/21 时各一段
    const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const mk = (h, m, minutes, cat, host, url) => ({
      start: dayStart + (h * 60 + m) * 60_000,
      end: dayStart + (h * 60 + m + minutes) * 60_000,
      date: key(0), host, url, categoryId: cat, incognito: false, endReason: 'event',
    });
    const sessions = [
      mk(9, 15, 45, 'work', 'github.com', 'https://github.com/'),
      mk(10, 30, 35, 'learning', 'www.bilibili.com', 'https://www.bilibili.com/video/BV1'),
      mk(14, 0, 28, 'entertainment', 'twitter.com', 'https://twitter.com/'),
      mk(15, 20, 36, 'entertainment', 'live.bilibili.com', 'https://live.bilibili.com/1'),
      mk(20, 5, 50, 'learning', 'www.bilibili.com', 'https://www.bilibili.com/video/BV2'),
      mk(21, 30, 22, 'entertainment', 'twitter.com', 'https://twitter.com/'),
    ];
    for (const r of rows) await put(db, 'usageDaily', r);
    for (const s of sessions) await put(db, 'sessions', s);
    db.close();
    // 专注模式演示状态（IT4）
    await chrome.storage.local.set({
      settings: {
        dayCutoffHour: 0, idleGraceSec: 60, idleThresholdSec: 3600,
        exemptPerDay: 2, exemptMinutes: 5,
        focusUntil: Date.now() + 22 * 60_000,
      },
    });
  });
  await page.close();
}

const shots = [
  // ?demo=1：popup 的演示钩子（正常工具栏弹窗无 query）——截图环境中 popup 是标签页而非覆盖层，
  // active tab 会变成 popup 自己导致 current 为空，demo 参数补上真实使用时的观感
  { file: `${PREFIX}popup.png`, url: `chrome-extension://${extensionId}/popup.html?demo=1`, w: 380, h: 720 },
  {
    file: `${PREFIX}guide.png`,
    url: `chrome-extension://${extensionId}/guide.html?cat=entertainment&url=${encodeURIComponent('https://twitter.com/')}`,
    w: 960,
    h: 800,
  },
  { file: `${PREFIX}options.png`, url: `chrome-extension://${extensionId}/options.html`, w: 1000, h: 1400 },
  { file: `${PREFIX}dashboard.png`, url: `chrome-extension://${extensionId}/dashboard.html`, w: 1180, h: 1100 },
];

await seedDemoData();
for (const s of shots) {
  const page = await ctx.newPage();
  await page.setViewportSize({ width: s.w, height: s.h });
  await page.goto(s.url);
  await page.waitForTimeout(1_200);
  await page.screenshot({ path: path.join(outDir, s.file), fullPage: true });
  console.log('[shots]', s.file);
  await page.close();
}
await ctx.close();
process.exit(0);
