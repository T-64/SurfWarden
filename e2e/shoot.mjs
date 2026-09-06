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
    const d = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const rows = [
      { date: d, categoryId: 'learning', host: 'www.bilibili.com', seconds: 3120, visits: 4 },
      { date: d, categoryId: 'entertainment', host: 'twitter.com', seconds: 1680, visits: 9 },
      { date: d, categoryId: 'entertainment', host: 'live.bilibili.com', seconds: 2040, visits: 3 },
      { date: d, categoryId: 'work', host: 'github.com', seconds: 4740, visits: 12 },
      { date: d, categoryId: 'neutral', host: 'www.google.com', seconds: 360, visits: 6 },
      { date: d, categoryId: 'neutral', host: 'stackoverflow.com', seconds: 900, visits: 3 },
    ];
    for (const r of rows) await put(db, 'usageDaily', r);
    db.close();
  });
  await page.close();
}

const shots = [
  { file: `${PREFIX}popup.png`, url: `chrome-extension://${extensionId}/popup.html`, w: 380, h: 720 },
  {
    file: `${PREFIX}guide.png`,
    url: `chrome-extension://${extensionId}/guide.html?cat=entertainment&url=${encodeURIComponent('https://twitter.com/')}`,
    w: 960,
    h: 800,
  },
  { file: `${PREFIX}options.png`, url: `chrome-extension://${extensionId}/options.html`, w: 1000, h: 1400 },
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
