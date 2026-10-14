/** assets/icon.svg → public/icon/{16,32,48,128}.png（WXT 自动写入 manifest）。用法：node e2e/render-icon.mjs */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const svg = fs.readFileSync(path.resolve('assets/icon.svg'), 'utf8');
const browser = await chromium.launch({ channel: process.env.E2E_CHANNEL ?? 'msedge' });
for (const size of [16, 32, 48, 128]) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await page.screenshot({ path: path.resolve(`public/icon/${size}.png`), omitBackground: true });
  await page.close();
}
// 预览：放大对比各尺寸
const page = await browser.newPage({ viewport: { width: 560, height: 200 } });
const imgs = [16, 32, 48, 128].map((s) => `<img src="data:image/png;base64,${fs.readFileSync(`public/icon/${s}.png`).toString('base64')}" style="width:${s}px;height:${s}px;margin:16px;image-rendering:auto">`).join('');
await page.setContent(`<body style="margin:0;display:flex;align-items:center;background:#f3f0e8">${imgs}</body>`);
if (process.argv[2]) await page.screenshot({ path: process.argv[2] });
await browser.close();
console.log('icons → public/icon/');
