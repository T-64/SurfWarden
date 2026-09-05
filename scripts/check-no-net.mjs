/**
 * 隐私红线检查（PRODUCT.md G4 / dev-process §3）：源码不得包含任何网络请求 API。
 * 用法：npm run check:privacy —— 命中即退出码 1。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOTS = ['src', 'entrypoints'];
const EXT = /\.(ts|tsx|js|jsx|mjs)$/;

const PATTERNS = [
  { name: 'fetch()', re: /\bfetch\s*\(/ },
  { name: 'XMLHttpRequest', re: /XMLHttpRequest/ },
  { name: 'WebSocket', re: /\bWebSocket\s*\(/ },
  { name: 'sendBeacon', re: /sendBeacon/ },
  { name: 'EventSource', re: /\bEventSource\s*\(/ },
  { name: 'axios', re: /\baxios\b/ },
];

const hits = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === 'node_modules' || name === '__pycache__') continue;
      walk(p);
    } else if (EXT.test(name)) {
      const lines = readFileSync(p, 'utf8').split('\n');
      lines.forEach((line, i) => {
        for (const { name: n, re } of PATTERNS) {
          if (re.test(line)) hits.push(`${p}:${i + 1}  [${n}]  ${line.trim()}`);
        }
      });
    }
  }
}
for (const r of ROOTS) walk(r);

if (hits.length > 0) {
  console.error('✗ 隐私红线违规（网络 API 出现在源码中）：');
  for (const h of hits) console.error('  ' + h);
  process.exit(1);
}
console.log('✓ 隐私红线检查通过：src/ 与 entrypoints/ 无任何网络请求 API');
