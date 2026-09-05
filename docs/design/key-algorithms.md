# 关键算法设计（Key Algorithms）

> 版本基线 v0.1。三个核心算法：计时状态机、规则匹配、预算与封锁。全部设计为纯函数，chrome 依赖由 adapter 注入。

## 1. 计时状态机（tracker）

### 1.1 "正在使用页面 X"的判定

`(该窗口聚焦) ∧ (X 是该窗口 active tab) ∧ (document 可见) ∧ (系统非 idle)`

四条件由事件归一化表达，状态机只消费归一化事件：

```ts
type TrackerEvent =
  | { type: 'tab-activated'; windowId: number; tabId: number; at: number }
  | { type: 'tab-updated';   windowId: number; tabId: number; url: string; title?: string; at: number }
  | { type: 'tab-removed';   tabId: number; at: number }
  | { type: 'window-focus';  windowId: number; at: number }        // WINDOW_ID_NONE = -1
  | { type: 'idle-changed';  state: 'active'|'idle'|'locked'; at: number }
  | { type: 'heartbeat';     at: number }
  | { type: 'startup';       at: number }                          // 浏览器启动
```

`deps`（adapter 注入）：`{ now(): number; classify(url: string, incognito: boolean): { categoryId; ruleId? } }`

### 1.2 核心转移 `step(state, event, deps) → { state, closed?: SessionRow }`

核心逻辑三条：

1. **开段**：任何使"使用中"成立的事件（tab-activated / window-focus 到有效窗口 / idle→active / tab-updated 且当前无段），若 `current === null` 且存在已知聚焦 active tab → 开段，`startedAt = at`
2. **换段**：URL 变化或 active tab 变化 → 关旧段开新段（同一次 step 内完成，边界时间戳连续）
3. **关段**：`idle/locked`、`window-focus → -1`、active tab 被关闭 → 关段，`endReason` 相应标记

### 1.3 时间语义（防虚增的关键）

- `lastActiveAt` 水位：取 max(所有 activity 事件时间, heartbeat 时间)——heartbeat 只在 `current !== null` 时更新水位（SW 活着 + 状态机认为在用时，才有权延长段）
- **关闭任何段时**：`end = min(事件时间, lastActiveAt + idleGraceSec)`；若 `end <= start` 则整段丢弃。这就是"宽限截断"：SW 被杀 10 分钟后复活时，那 10 分钟不会被计入
- `startup` 事件：若 session 存储里残留段（浏览器异常退出），按水位+宽限截断入库，然后重置状态
- **边界用例表**（表驱动测试直接由本表生成）：

| # | 场景 | 事件序列 | 期望 |
|---|------|---------|------|
| E1 | 正常切换 | activated(A)→activated(B) | A 段闭合，B 开段，边界连续 |
| E2 | 单页久留+心跳 | activated(A)→hb*120(1h) | A 段 = 60min（水位持续延长）|
| E3 | SW 被杀 10min | activated(A)→hb→(10min 静默)→hb | 段被 cap 在水位+60s，第二段重新开 |
| E4 | idle | activated(A)→idle-changed(idle) | 段闭合 endReason='idle' |
| E5 | idle 回来 | idle→idle-changed(active) | 新段（deps.classify 重新执行）|
| E6 | 全窗口失焦 | activated(A)→window-focus(-1) | 段闭合 endReason='blur' |
| E7 | 关闭 active tab | activated(A)→tab-removed(A) | 段闭合 |
| E8 | URL 变化 | activated(A)→updated(A, url2) | A1 闭合 + A2 开段，classify 重跑 |
| E9 | 浏览器重启残留 | snapshot 有段 + startup | 截断入库 + 状态清空 |
| E10 | 空段 | 开段同刻关段 | end<=start，丢弃不写库 |
| E11 | 心跳但无段 | heartbeat 且 current=null | 水位不动，无段产生 |
| E12 | 跨 dayCutoff | 段 23:58→00:03（cutoff=0） | 拆两段，date 各归其日 |

E12 说明：关段时若 `start` 与 `end` 落在不同 dateKey，**按天拆分**（同一 URL 两个 SessionRow），保证不变量 3 成立。

## 2. 规则匹配（urlMatch）

### 2.1 语法与 specificity 分值

| pattern 形态 | 识别 | specificity | 分值 | 匹配语义 |
|------|------|------|------|---------|
| `https://a.com/x?y=1` | 有 scheme | exact | 10 | 完整 URL 相等（忽略 hash）|
| `re:...` | `re:` 前缀 | regex | 6 | `new RegExp(其余部分).test(href)` |
| `a.com/path/*` | 含 `/` 路径部分 | path | 8 | host 匹配且 pathname 符合通配 |
| `*.a.tv/*` | 首段 `*.` | wildcard | 2 | 通配子域 |
| `a.com` | 其余 | domain | 4 | `host === a.com \|\| host.endsWith('.a.com')` |

注意 path 的语义：`bilibili.com/video/*` = host 是 bilibili.com（含子域）且 pathname 以 `/video/` 开头——`*` 只在尾部使用（P0 不做中置通配），语法简单才可测。

### 2.2 匹配流程

1. 启动时把 rules 编译为 `CompiledRule[]`（解析 pattern → 判别 specificity + 匹配闭包），**按 (分值 desc, createdAt asc) 排序**
2. `match(href)`：顺序扫描，首个命中返回 `{ ruleId, categoryId }`
3. 无命中 → `settings` 的默认类别（neutral）

### 2.3 测试表

模板规则 × 典型 URL 全组合表驱动（含：子域命中、大小写、带端口、hash 忽略、优先级打平按 createdAt、re: 语法、无匹配默认类别）。

## 3. 预算与封锁（budget / blocker）

### 3.1 预算状态（纯函数）

```ts
type BudgetState = 'ok' | 'warn' | 'exhausted'
budgetState(usedSec, budgetMin, warnRatio=0.8): BudgetState
```

`usage_daily` 按 (date, categoryId) 求和得 usedSec；`exhausted` 且 `action='budget'` → 触发封锁；`hard` 类别无条件封锁；`nudge` 类别 exhausted 只继续横幅不封。

### 3.2 DNR 规则生命周期（blocker，v0.2）

- 规则 id 分配：`categoryId 哈希 → 固定 id 段`（每类别一条规则，urlFilter 为该类别全部规则域名的 `\|\|` 前缀交替，或每域名一条——v0.2 实现时定，见 ADR-0008）
- 加入时机：`usage 检查点`（segment 关闭后）发现 exhausted
- 移除时机：日切（alarms 于 dayCutoff 触发）/ 豁免窗口开启
- **豁免**：`exempts[date].count < exemptPerDay` → 移除规则 + alarms 定 5min 后恢复 + count+1；恢复时若 usedSec 又涨了，重算是否仍 exhausted

### 3.3 日切（datetime 纯函数）

`dateKey(ts, cutoffHour)`：cutoff=0 → 本地日；cutoff=4 → 00:00–03:59 归前一天。日切 alarm 重置：预算（数据本身按日存，天然重置）、豁免 count（不删行，按 date 查当日行）、DNR 规则清空。

## 4. 心跳（MV3 生命周期对策，ADR-0003）

- `chrome.alarms` 每 30s → SW 醒来 → 发 `heartbeat` 事件给状态机 → 若在计时则水位前移 → 状态回写 `chrome.storage.session` → SW 自然休眠
- 状态写 session 的时机：**每次 step 产生状态变化后**（事件量低频，写入成本可忽略）
