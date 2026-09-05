# 权威参考笔记（References）

> 实现"不凭记忆乱写"：关键 API 行为以官方文档为准，本文记录查证结论 + 链接。查证日期 2026-09-06。

## 1. WXT（插件框架）

来源：https://wxt.dev/guide/installation.html

- 初始化：`npx wxt@latest init`（模板默认 TypeScript），或手搭 `npm i -D wxt`
- 入口统一放 `entrypoints/`，如 `entrypoints/background.ts`：
  ```ts
  export default defineBackground(() => { /* ... */ });
  ```
  `defineBackground` 等由 WXT 自动导入
- 命令：`wxt`（dev，自动开浏览器装好扩展）、`wxt build`、`wxt zip`、`wxt prepare`（postinstall）

## 2. Playwright 测 Chrome 扩展

来源：https://playwright.dev/docs/chrome-extensions

- 扩展只能在**持久化上下文**里跑：
  ```js
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    args: [
      `--disable-extensions-except=${pathToExtension}`,
      `--load-extension=${pathToExtension}`,
    ],
  });
  ```
- headless 跑扩展必须 `channel: 'chromium'`（Playwright 自带 Chromium），否则有头模式
- MV3 background 是 service worker，获取方式：
  ```js
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const extensionId = sw.url().split('/')[2];
  ```
- SW ~30s 不活动会被挂起并按需重启；重启瞬间在飞的 `evaluate()` 会抛 "Service worker restarted"
- 打开扩展页面：`page.goto('chrome-extension://${extensionId}/popup.html')`

## 3. chrome.declarativeNetRequest（MV3）

来源：https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest

- 权限：`declarativeNetRequest`（装时有权限警告，隐式允许 allow/block）；**redirect 到具体 host 仍需 host 权限**——本项目已计划 `<all_urls>`
- 动态规则（本项目用这个）：`updateDynamicRules({ removeRuleIds, addRules })`，**原子操作**，跨浏览器会话、跨扩展更新持久；规则 id 唯一且 ≥1，priority ≥1
- 重定向到扩展内页：
  ```json
  { "id": 1, "priority": 1,
    "action": { "type": "redirect", "redirect": { "extensionPath": "/guide.html" } },
    "condition": { "urlFilter": "||twitter.com/", "resourceTypes": ["main_frame"] } }
  ```
  **前提：该路径必须声明在 manifest 的 `web_accessible_resources`，否则报错**
- urlFilter 语法：`||twitter.com/` 匹配该域及全部子域的全部路径（官方推荐整域写法）；`|` 左右锚定；`^` 分隔符
- 同优先级时动作序：allow > block > upgradeScheme > redirect
- 限额：动态规则 ≥5000（Chrome 121+ 安全规则可到 30000）——远超本项目需求
- 带查询参数跳转：`extensionPath` 不能带 query；用 `redirect.url` + `chrome.runtime.getURL('guide.html?url=...')`（URLTransform 允许 `chrome-extension` scheme）

## 4. Dexie（IndexedDB 封装）

来源：https://dexie.org/docs/Typescript

- 类型内置：`import Dexie, { type EntityTable } from 'dexie'`
- 最小模式：
  ```ts
  const db = new Dexie('DB') as Dexie & { friends: EntityTable<Friend, 'id'> };
  db.version(1).stores({ friends: '++id, name, age' });
  ```
- schema 字符串：`++id` 自增主键；索引逗号分隔；复合主键写法 `[a+b+c]`
- 扩展内所有页面与 SW 共享同一 IndexedDB（同 extension origin），popup 可直接查询

## 5. chrome.idle / MV3 生命周期

- `chrome.idle.setDetectionInterval(seconds)`（最小 15s）+ `chrome.idle.onStateChanged`：状态 `active | idle | locked`
- `chrome.alarms` 周期下限 30s（Chrome 120+）；`chrome.storage.session` 在 SW 重启间保留（浏览器重启清空）——用作计时水位
- SW 空闲 ~30s 被终止，事件/闹钟/消息会重新唤醒（与 Playwright 文档互相印证）

## 6. 产品层参考（竞品与先行者，来自前期调研）

- Binge-Meter（https://github.com/sahaj-b/binge-meter）：分心站计时 + AI 分类 + 悬浮计时器，验证了"规则优先、AI 兜底、缓存"路径
- LeechBlock NG（https://www.proginosko.com/leechblock/documentation/）：多规则组 + 正则例外，但 URL 白名单无法覆盖"德语课"这类内容语义
- one sec（https://one-sec.app/）：强制摩擦降低冲动访问（称 -57%）
- Intention（https://www.getintention.com/）：打开分心站前询问意图并承诺时限
- ActivityWatch（https://activitywatch.net/）：本地优先时间追踪的成熟实现，分类规则思路参考
