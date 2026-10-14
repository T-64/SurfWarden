/**
 * 文档截图：灌 14 天演示数据 → 截 popup / report / options（遮罩截图由 SHOTS=… npm run e2e 产出）。
 * 用法：npm run build && node e2e/shoot.mjs [输出目录，默认 docs/images]
 * 演示数据只写进临时 profile，不碰真实浏览器。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const OUT = path.resolve(process.argv[2] ?? 'docs/images');
fs.mkdirSync(OUT, { recursive: true });

const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end('<title>live</title><h1>直播间</h1>');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

const ext = path.resolve('.output/chrome-mv3');
const profile = fs.mkdtempSync(path.resolve('.output/shoot-profile-'));
const ctx = await chromium.launchPersistentContext(profile, {
  channel: process.env.E2E_CHANNEL ?? 'msedge',
  headless: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP *.test 127.0.0.1'],
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 20_000 });
const extId = sw.url().split('/')[2];
await new Promise((r) => setTimeout(r, 1000));
await sw.evaluate(async () => {
  const { settings } = await chrome.storage.local.get('settings');
  const { rules } = await chrome.storage.local.get('rules');
  await chrome.storage.local.set({
    settings: { ...settings, idleThresholdSec: 3600 },
    rules: [...rules, { id: 'demo', pattern: 'live.test', category: 'drift', createdAt: 999 }],
    lastGerman: { url: 'https://learngerman.dw.com/de/nicos-weg/c-36519687', title: 'Nicos Weg · Folge 12', at: Date.now() },
  });
});

// ---------- 演示数据 ----------
const CUT = 5;
const dk = (ts) => {
  const d = new Date(ts - CUT * 3_600_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const today = dk(Date.now());
const [Y, M, D] = today.split('-').map(Number);
const at = (dayOffset, h, m) => new Date(Y, M - 1, D + dayOffset + (h < CUT ? 1 : 0), h, m).getTime();
const german = [20, 45, 50, 0, 30, 60, 45, 15, 50, 55, 40, 47, 52, 38];
const drift = [80, 60, 40, 95, 70, 45, 30, 65, 20, 25, 35, 50, 30, 65];
const study = [180, 210, 150, 90, 200, 240, 60, 30, 220, 190, 210, 170, 200, 150];
const nights = [[23, 40], [0, 55], [23, 10], [22, 58], [1, 20], [23, 5], [22, 45], [22, 52], [23, 30], [22, 40], [22, 55], [23, 15], [22, 50]];
const mornings = [[8, 40], [9, 10], [7, 55], [7, 40], [8, 5], [9, 20], [7, 35], [7, 45], [7, 50], [7, 30], [7, 40], [7, 50], [7, 35], [7, 45]];
const usage = [];
const days = [];
for (let i = 0; i < 14; i++) {
  const off = i - 13;
  const date = dk(at(off, 12, 0));
  usage.push(
    { date, category: 'german', host: 'learngerman.dw.com', seconds: german[i] * 45 },
    { date, category: 'german', host: 'www.bilibili.com', seconds: german[i] * 15 },
    { date, category: 'drift', host: 'live.bilibili.com', seconds: drift[i] * 40 },
    { date, category: 'drift', host: 'x.com', seconds: drift[i] * 20 },
    { date, category: 'study', host: 'github.com', seconds: study[i] * 30 },
    { date, category: 'study', host: 'ilias3.uni-stuttgart.de', seconds: study[i] * 30 },
    { date, category: 'other', host: 'www.google.com', seconds: 1500 },
  );
  if (i < 13) days.push({ date, firstAt: at(off, ...mornings[i]), lastAt: at(off, ...nights[i]) });
  else days.push({ date, firstAt: at(off, ...mornings[i]), lastAt: Date.now() });
}
const blocks = [
  [8, 10, 8, 40, 'other', 'www.google.com'],
  [9, 0, 11, 30, 'study', 'ilias3.uni-stuttgart.de'],
  [12, 10, 12, 50, 'german', 'learngerman.dw.com'],
  [13, 0, 13, 35, 'drift', 'live.bilibili.com'],
  [14, 0, 17, 0, 'study', 'github.com'],
  [19, 30, 20, 0, 'drift', 'x.com'],
  [20, 15, 20, 50, 'german', 'www.bilibili.com'],
];
const sessions = blocks.map(([h1, m1, h2, m2, category, host], i) => ({
  id: `demo${i}|${today}`,
  segId: `demo${i}`,
  date: today,
  start: at(0, h1, m1),
  end: at(0, h2, m2),
  host,
  url: `https://${host}/`,
  category,
  source: 'rule',
  incognito: false,
}));
const events = [
  { date: today, at: at(0, 13, 0), type: 'pass', site: 'bilibili.com', intent: '放松一下', minutes: 10 },
  { date: today, at: at(0, 13, 12), type: 'pass', site: 'bilibili.com', intent: '看一个具体的视频 / 直播', minutes: 20 },
  { date: today, at: at(0, 19, 30), type: 'pass', site: 'x.com', intent: '查个东西', minutes: 5 },
  { date: today, at: at(0, 13, 36), type: 'go-german' },
  { date: dk(at(-1, 12, 0)), at: at(-1, 23, 20), type: 'curfew-ext', reason: 'Abgabe 明早截止，交作业', minutes: 10, site: 'ilias3.uni-stuttgart.de' },
];

const seedPage = await ctx.newPage();
await seedPage.goto(`chrome-extension://${extId}/report.html`); // Dexie 先建好 schema
await seedPage.waitForTimeout(800);
await seedPage.evaluate(
  (data) =>
    new Promise((resolve, reject) => {
      const req = indexedDB.open('SurfWardenV3');
      req.onsuccess = () => {
        const tx = req.result.transaction(['usage', 'days', 'sessions', 'events'], 'readwrite');
        for (const [store, rows] of Object.entries(data)) for (const r of rows) tx.objectStore(store).put(r);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      };
    }),
  { usage, days, sessions, events },
);
await seedPage.close();

// ---------- 截图 ----------
const live = await ctx.newPage();
await live.goto(`http://live.test:${PORT}/`);
await live.waitForTimeout(1500);
const liveTabId = await sw.evaluate(async () => (await chrome.tabs.query({ url: '*://live.test/*' }))[0]?.id);

const popup = await ctx.newPage();
await popup.setViewportSize({ width: 340, height: 720 });
await popup.goto(`chrome-extension://${extId}/popup.html?tab=${liveTabId}`);
await popup.waitForTimeout(1200);
const h = await popup.evaluate(() => document.body.scrollHeight);
await popup.setViewportSize({ width: 340, height: h });
await popup.screenshot({ path: path.join(OUT, 'v3-popup.png') });

const report = await ctx.newPage();
await report.setViewportSize({ width: 1160, height: 900 });
await report.goto(`chrome-extension://${extId}/report.html`);
await report.waitForTimeout(1500);
await report.screenshot({ path: path.join(OUT, 'v3-report.png'), fullPage: true });
await report.setViewportSize({ width: 390, height: 900 });
await report.waitForTimeout(500);
await report.screenshot({ path: path.join(OUT, 'v3-report-narrow.png'), fullPage: true });

const options = await ctx.newPage();
await options.setViewportSize({ width: 960, height: 900 });
await options.goto(`chrome-extension://${extId}/options.html`);
await options.waitForTimeout(1200);
await options.screenshot({ path: path.join(OUT, 'v3-options.png'), fullPage: true });

await ctx.close();
server.close();
fs.rmSync(profile, { recursive: true, force: true });
console.log('screenshots →', OUT);
