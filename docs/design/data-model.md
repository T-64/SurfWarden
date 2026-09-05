# 数据模型设计（Data Model）

> 版本基线 v0.1。所有领域类型以 `src/core/types.ts` 为唯一权威，本文是它的"为什么"。

## 1. 配置类（chrome.storage.local，用户可改，量小）

```ts
type CategoryId = 'learning' | 'work' | 'entertainment' | 'neutral' | (string & {})

interface Category {
  id: CategoryId
  name: string            // 显示名
  color: string           // badge/图表色
  budgetMin?: number      // 每日预算（分钟）；undefined = 不设限（正向类）
  action: 'track' | 'nudge' | 'budget' | 'hard'   // 监督档位，PRODUCT.md §3.4
}

interface Rule {
  id: string              // uuid
  name: string
  pattern: string         // 见 key-algorithms.md §2 的语法
  category: CategoryId
  enabled: boolean
  createdAt: number       // 同 specificity 打平时按此先后
}

interface StudyTarget {   // (v0.2) PRODUCT.md §3.6
  id: string
  name: string            // "德语课 A2"
  url: string
}

interface Settings {
  dayCutoffHour: number   // 一天结束时刻，默认 0
  idleGraceSec: number    // 心跳丢失宽限，默认 60
  idleThresholdSec: number// idle 判定阈值，默认 60（15–300 可配）
  exemptPerDay: number    // 豁免次数/天，默认 2
  exemptMinutes: number   // 单次豁免时长，默认 5
  pauseUntil?: number     // "暂停监督"截止时间戳
}
```

存储布局：`{ rules: Rule[], categories: Category[], studyTargets: StudyTarget[], settings: Settings }`，各存一个 key，读取方各自容错（首次使用写默认值）。

## 2. 数据类（IndexedDB / Dexie，量大、按日期查询）

```ts
/** 一次连续停留的明细段。sessions 表 */
interface SessionRow {
  id?: number             // 自增主键
  start: number           // 开始时间戳 ms
  end: number             // 结束时间戳 ms
  date: string            // 'YYYY-MM-DD'（按 dayCutoff 归属，便于按天查询）
  host: string
  url: string
  title?: string
  categoryId: CategoryId  // 记录判定时刻的类别；改判 = 原地更新
  ruleId?: string         // 命中的规则；改判后为 'manual'
  incognito: boolean
  endReason: 'event' | 'idle' | 'blur' | 'cap'   // cap = 心跳宽限截断
}

/** 按日聚合。usage_daily 表，复合主键保证 upsert 幂等 */
interface UsageRow {
  key: [string, CategoryId, string]   // [date, categoryId, host]
  date: string
  categoryId: CategoryId
  host: string
  seconds: number
  visits: number
}

/** 豁免记录，一天一行 */
interface ExemptRow {
  date: string            // 主键
  count: number
}
```

Dexie schema（版本 1）：

```
sessions:    '++id, date, categoryId, host, start'
usage_daily: '[date+categoryId+host], date'
exempts:     'date'
```

要点：
- **聚合幂等**：Segment 写入采用 `usage_daily` upsert（读-改-写在同一事务），SW 崩溃重放同一段不会双计——段关闭只会发生一次（状态机保证），但 upsert 幂等是第二道保险
- **改判一致性**：改判 = 事务内更新 SessionRow + 旧类别减秒 + 新类别加秒，三步同事务
- **保留策略**：sessions 90 天清理（alarms 每日触发），usage_daily 永久

## 3. 运行时瞬态（chrome.storage.session，SW 重启间保留）

```ts
/** 计时状态机持久化快照 */
interface TrackerSnapshot {
  current: {
    windowId: number
    tabId: number
    url: string
    host: string
    categoryId: CategoryId
    ruleId?: string
    incognito: boolean
    startedAt: number
  } | null
  lastActiveAt: number    // 心跳/事件水位
}
```

为什么放 session 而非 local：浏览器重启后旧段必须作废（宽限截断），session 存储自动清空正好给出这个语义；`onStartup` 时若发现遗留快照（异常退出），按 `lastActiveAt + grace` 截断入库。

## 4. 不变量（Invariants）——测试用例的源头

1. 任意时刻 `current === null` 或 `current.startedAt <= now`
2. 段时长 `end - start >= 0`；被 cap 的段必有 `endReason='cap'` 且 `end = lastActiveAt + grace`
3. 同一 `(date, categoryId, host)` 的 usage_daily.seconds === 该日该键下所有 SessionRow 时长之和
4. 豁免数 ≤ settings.exemptPerDay/天
5. DNR 动态规则集合在任何时刻只包含"已耗尽且未豁免"的类别域名集合（blocker 与 budget 状态一致）
