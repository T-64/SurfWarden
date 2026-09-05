# 架构设计（Architecture）

> 版本基线 v0.1（2026-09-06）。变更需在文末"变更记录"追加，重要取舍另立 ADR。

## 1. 总览

SurfWarden = 浏览器扩展（Chrome MV3 优先），单机单用户，全本地。

```
┌─────────────────────────── 浏览器进程边界 ───────────────────────────┐
│                                                                      │
│  Service Worker (background)                    扩展页面              │
│  ┌─────────────────────────────┐      ┌────────────────────────┐    │
│  │ trackerHost   事件接线/状态机 │      │ popup    今日概览/改判   │    │
│  │ ruleEngine     URL→类别      │      │ guide    引导页 (v0.2)  │    │
│  │ budgetHost    预算/豁免/日切  │      │ options  规则管理 (v0.3)│    │
│  │ blocker       DNR 动态规则   │      └───────────┬────────────┘    │
│  └───────┬─────────────────────┘                  │                 │
│          │        共享存储                          │                 │
│  ┌───────┴──────────────────────────────────────────┴────────────┐   │
│  │ chrome.storage.local（配置） + IndexedDB/Dexie（明细与聚合）      │   │
│  └───────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  content scripts: nudge 横幅 (v0.2) / intent 打卡 (P1)               │
└──────────────────────────────────────────────────────────────────────┘
```

- 计时/预算/封锁的唯一权威在 Service Worker；扩展页面只读写存储，不重复维护状态。
- 扩展页面与 SW 共享同一 IndexedDB（同 extension origin），popup 直接查询，避免长消息协议。

## 2. 分层与目录

遵守 dev-process.md §2 的三层约束：

```
surfwarden/
├── entrypoints/            # WXT 入口层（组装，不含算法）
│   ├── background.ts       # SW：事件接线 → core.step → adapters 写入
│   ├── popup/              # index.html + main.tsx + App.tsx
│   ├── guide/              # (v0.2) 引导页
│   └── options/            # (v0.3) 设置页
├── src/
│   ├── core/               # 纯逻辑层（无 chrome 依赖，vitest 主战场）
│   │   ├── types.ts        # 全部领域类型
│   │   ├── tracker.ts      # 计时状态机 step()
│   │   ├── urlMatch.ts     # 规则编译与匹配
│   │   └── budget.ts       # 预算状态计算、日界
│   ├── adapters/
│   │   ├── chromeEvents.ts # tabs/windows/idle/alarms 事件 → TrackerEvent
│   │   ├── db.ts           # Dexie schema 与查询
│   │   ├── configStore.ts  # chrome.storage 读写（规则/类别/设置/学习目标）
│   │   └── dnr.ts          # declarativeNetRequest 动态规则封装
│   └── shared/
│       ├── defaults.ts     # 默认类别/设置/模板包
│       └── datetime.ts     # dateKey(cutoff)、跨天判断（纯函数）
├── docs/
└── wxt.config.ts
```

## 3. 进程与数据流

**计时流**：Chrome 事件 → `adapters/chromeEvents` 归一化为 `TrackerEvent` → `core/tracker.step(state, event, deps)` 返回新状态 + 被关闭的 `Segment` → adapter 把 Segment 写入 Dexie（sessions 明细 + usage_daily 聚合）→ 新状态存 `chrome.storage.session`。

**改判流**（popup 一键改判，v0.2）：popup 计算出目标会话段 → 直接更新 Dexie 对应 SessionRow.categoryId 并重算该日聚合 → SW 下一次读取时以存储为准，无缓存冲突（SW 不缓存聚合）。

**封锁流**（v0.2）：budgetHost 检测到预算耗尽 → `dnr.addRedirectRules(category)` → 命中 `main_frame` 重定向到 `/guide.html?url=<原始URL>` → 引导页读 query 展示统计与动作（豁免/去学习）。

## 4. Manifest 与权限（v0.1 基线）

| 权限 | 用途 |
|------|------|
| `tabs` | 读取 active tab 的 url/title 用于分类与统计 |
| `idle` | 系统级发呆/锁屏检测 |
| `alarms` | 心跳水位、预算日切、豁免倒计时 |
| `storage` | chrome.storage（配置 + session 水位） |
| `declarativeNetRequest` | (v0.2) 动态重定向规则 |
| host `<all_urls>` | DNR redirect 需要对目标 host 的权限；tabs 读取 URL |

隐私红线（PRODUCT.md G4）：除上述浏览器 API 外**零网络请求**；CI 中用 `grep -rE "fetch\(|XMLHttpRequest|WebSocket" src/ entrypoints/` 抽查（adapters/db 除外说明）。

## 5. 技术栈（ADR-0001/0002）

- WXT + TypeScript + React（popup/guide/options UI）+ Dexie
- 测试：vitest（core 全覆盖）+ Playwright（v0.2 起 E2E 冒烟）

## 6. 变更记录

- 2026-09-06 v0.1：初稿，按 PRODUCT.md 落地分层与目录。
