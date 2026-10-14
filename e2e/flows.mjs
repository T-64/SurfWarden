/**
 * v3 真机 E2E：Playwright 驱动本机 Edge + 加载 .output/chrome-mv3。
 * 用法：npm run build && npm run e2e
 *
 * 网络隔离：*.test 与 www.bilibili.com 经 --host-resolver-rules 映射到本地 HTTP 服务（显式端口，
 * 避开 HTTPS 自动升级），全程不访问外网。时段靠改 settings.schedule 相对"现在"摆放。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const SHOTS = process.env.SHOTS ? path.resolve(process.env.SHOTS) : null;
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

// ---------- 本地站点 ----------
const pages = {
  'german.test': '<h1>Nicos Weg · Folge 12</h1><p>Deutsch lernen</p>',
  'drift.test': '<h1>Live</h1><video id="v" muted loop></video><p>endless feed</p>',
  'other.test': '<h1>Random blog</h1>',
};
const server = http.createServer((req, res) => {
  const host = (req.headers.host ?? '').split(':')[0];
  res.setHeader('content-type', 'text/html; charset=utf-8');
  if (host === 'www.bilibili.com') {
    const mid = req.url.includes('BVde') ? '279118193' : '999';
    const name = mid === '999' ? '游戏区UP' : '德国百科DEPedia';
    res.end(`<title>bili</title><meta name="author" content="${name}"><div class="up-panel-container"><a class="up-name" href="//space.bilibili.com/${mid}/">${name}</a></div><video></video>`);
    return;
  }
  res.end(`<title>${host}</title>${pages[host] ?? '<h1>?</h1>'}`);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const url = (host, p = '/') => `http://${host}:${PORT}${p}`;

// ---------- 浏览器 ----------
const ext = path.resolve('.output/chrome-mv3');
const profile = fs.mkdtempSync(path.resolve('.output/e2e-profile-'));
const ctx = await chromium.launchPersistentContext(profile, {
  // 本机 Edge（Playwright 自带 Chromium 版本随依赖漂移；Edge 仍支持 --load-extension）
  channel: process.env.E2E_CHANNEL ?? 'msedge',
  headless: process.env.E2E_HEADED ? false : true,
  viewport: { width: 1100, height: 760 },
  args: [
    `--disable-extensions-except=${ext}`,
    `--load-extension=${ext}`,
    `--host-resolver-rules=MAP *.test 127.0.0.1, MAP www.bilibili.com 127.0.0.1`,
  ],
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 20_000 });
const extId = sw.url().split('/')[2];
const getSw = () => ctx.serviceWorkers()[0] ?? sw;
const swEval = async (fn, arg) => {
  for (let i = 0; i < 3; i++) {
    try {
      return await getSw().evaluate(fn, arg);
    } catch (e) {
      if (i === 2) throw e;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
};

const mod = (m) => ((m % 1440) + 1440) % 1440;
const nowMin = () => {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
};
async function configure(schedulePatch = {}, settingsPatch = {}) {
  const m = nowMin();
  const schedule = { windDown: mod(m + 120), bedtime: mod(m + 180), wake: mod(m - 60), ...schedulePatch };
  await swEval(
    async ({ schedule, settingsPatch }) => {
      const { settings } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({
        settings: { ...settings, schedule, idleThresholdSec: 3600, driftCapMin: 60, ...settingsPatch },
        rules: [
          { id: 'e1', pattern: 'drift.test', category: 'drift', createdAt: 1 },
          { id: 'e2', pattern: 'german.test', category: 'german', createdAt: 2 },
          { id: 'e3', pattern: 'bilibili.com', category: 'drift', createdAt: 3 },
        ],
      });
    },
    { schedule, settingsPatch },
  );
  await new Promise((r) => setTimeout(r, 600));
}
async function readDb() {
  const p = await ctx.newPage();
  await p.goto(`chrome-extension://${extId}/report.html`);
  const out = await p.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open('SurfWardenV3');
        req.onsuccess = () => {
          const tx = req.result.transaction(['usage', 'events'], 'readonly');
          const u = tx.objectStore('usage').getAll();
          const e = tx.objectStore('events').getAll();
          tx.oncomplete = () => resolve({ usage: u.result, events: e.result });
        };
      }),
  );
  await p.close();
  return out;
}
const overlay = (page) => page.locator('surfwarden-gate .ov');
const banner = (page) => page.locator('surfwarden-gate .banner');
const shot = async (page, name) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${name}.png`) });

try {
  await new Promise((r) => setTimeout(r, 1000));
  await configure();
  const page = await ctx.newPage();

  // ---- 1. 计时：德语页 → 切到娱乐页，德语段落库 ----
  await page.goto(url('german.test'));
  await page.waitForTimeout(2500);
  check('德语页不弹遮罩', (await overlay(page).count()) === 0);

  // ---- 2. 白天闸门 ----
  await page.goto(url('drift.test'));
  await overlay(page).getByText('你本来想干嘛？').waitFor({ timeout: 8000 });
  check('娱乐页出现意图闸门', true);
  check('闸门期间页面滚动被锁', (await page.evaluate(() => document.documentElement.style.overflow)) === 'hidden');
  const db1 = await readDb();
  const germanSec = db1.usage.filter((r) => r.category === 'german').reduce((s, r) => s + r.seconds, 0);
  check('离开德语页后德语时长已落库', germanSec >= 2, `${germanSec.toFixed(1)}s`);
  const go = overlay(page).locator('button.primary');
  check('等待期按钮不可点', await go.isDisabled(), await go.textContent());
  await overlay(page).getByText('放松一下').click();
  await shot(page, 'v3-gate');
  await page.waitForTimeout(5200);
  check('等够 5 秒后可进入', !(await go.isDisabled()), await go.textContent());
  await go.click();
  await banner(page).waitFor({ timeout: 5000 });
  check('发放通行证后遮罩消失、出现倒计时', (await overlay(page).count()) === 0, await banner(page).textContent());

  // ---- 3. 通行证到期 → 时间到 → 去学德语 ----
  await swEval(async () => {
    const { passes } = await chrome.storage.session.get('passes');
    for (const k of Object.keys(passes)) passes[k].until = Date.now() - 1000;
    await chrome.storage.session.set({ passes });
  });
  await page.reload();
  await overlay(page).getByText('时间到').waitFor({ timeout: 8000 });
  check('通行证到期后显示「时间到」并复述意图', (await overlay(page).textContent()).includes('放松一下'));
  await shot(page, 'v3-expired');
  await overlay(page).locator('button.german').click();
  await page.waitForURL(/german\.test/, { timeout: 8000 });
  check('「去学德语」回到上次的德语页', page.url().includes('german.test'), page.url());

  // ---- 4. 再申请：等待递增 ----
  await page.goto(url('drift.test'));
  await overlay(page).getByText('时间到').waitFor({ timeout: 8000 });
  await overlay(page).getByText('再申请一次').click();
  await overlay(page).getByText('你本来想干嘛？').waitFor({ timeout: 8000 });
  const meta = await overlay(page).locator('.meta').textContent();
  check('第二次申请：次数 +1，等待 10 秒', meta.includes('第 2 次') && (await go.textContent()).includes('10'), meta);

  // ---- 5. 封顶 ----
  await configure({}, { driftCapMin: 0 });
  await overlay(page).getByText('今天的娱乐额度用完了').waitFor({ timeout: 8000 });
  check('额度为 0 时配置变更即时推送封顶', true);

  await page.goto(url('www.bilibili.com', '/video/BVgame2/'));
  await overlay(page).getByText('今天的娱乐额度用完了').waitFor({ timeout: 8000 });
  await overlay(page).getByText('其实是').waitFor({ timeout: 10000 });
  check('额度用完时，未知 UP 主仍可标记为德语', true);

  // ---- 6. B 站：德语 UP 主直接放行；未知 UP 主可一键标记 ----
  await configure();
  await page.goto(url('www.bilibili.com', '/video/BVde1/'));
  await page.waitForTimeout(3500);
  check('预置德语 UP 主（DEPedia）的视频不弹闸门', (await overlay(page).count()) === 0);
  await page.goto(url('www.bilibili.com', '/video/BVgame/'));
  await overlay(page).getByText('其实是').waitFor({ timeout: 10000 });
  check('未知 UP 主的视频：闸门里出现「其实是…」', true, await overlay(page).locator('.ask').textContent());
  await overlay(page).getByText('德语学习').click();
  await page.waitForTimeout(1500);
  check('标记为德语学习后立即放行', (await overlay(page).count()) === 0);

  // ---- 7. 收尾期 ----
  const m = nowMin();
  await configure({ windDown: mod(m - 10), bedtime: mod(m + 20), wake: mod(m + 600) });
  await page.goto(url('drift.test'));
  await overlay(page).getByText('离上床还有').waitFor({ timeout: 8000 });
  check('收尾期娱乐页直接拦截（不可申请）', (await overlay(page).getByText('你本来想干嘛').count()) === 0);
  await page.goto(url('other.test'));
  await banner(page).waitFor({ timeout: 8000 });
  check('收尾期其他页面放行并显示倒计时', (await banner(page).textContent()).includes('离上床'));

  // ---- 8. 宵禁 ----
  await configure({ windDown: mod(m - 60), bedtime: mod(m - 30), wake: mod(m + 60) });
  await page.goto(url('german.test'));
  await banner(page).waitFor({ timeout: 8000 });
  check('宵禁期德语页（白名单）放行并显示已晚', (await banner(page).textContent()).includes('已过就寝'));
  await page.goto(url('other.test'));
  await overlay(page).getByText('该睡了').waitFor({ timeout: 8000 });
  check('宵禁期非白名单页面拦截', true);
  await shot(page, 'v3-curfew');
  const reason = overlay(page).locator('.ext input');
  const extBtn = overlay(page).locator('.ext button');
  await reason.fill('看看');
  check('理由太短不能延长', await extBtn.isDisabled());
  await reason.fill('明早要交的作业截止');
  await extBtn.click();
  await banner(page).waitFor({ timeout: 8000 });
  check('写理由后延长放行', (await banner(page).textContent()).includes('宵禁延长'));
  await page.goto(url('drift.test'));
  await overlay(page).getByText('该睡了').waitFor({ timeout: 8000 });
  check('延长期内娱乐站仍拦截', (await overlay(page).getByText('娱乐站在宵禁期间不能延长').count()) === 1);

  const db2 = await readDb();
  const types = db2.events.map((e) => e.type);
  check(
    '事件日志：通行证 ×1、去学德语、标记频道、宵禁延长',
    types.filter((t) => t === 'pass').length === 1 && types.includes('go-german') && types.includes('mark-channel') && types.includes('curfew-ext'),
    JSON.stringify(types),
  );
} catch (e) {
  check('未捕获异常', false, String(e?.stack ?? e));
} finally {
  await ctx.close();
  server.close();
  fs.rmSync(profile, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
process.exit(failed.length ? 1 : 0);
