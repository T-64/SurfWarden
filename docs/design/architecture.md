# 架构设计 v3

> 基线 2026-10-14，对应 PRODUCT.md v3。以后的偏差在文末"变更记录"里追加。

## 1. 分层

```
src/core/       纯逻辑：types / tracker / classify / urlMatch / policy / schedule / metrics —— 禁止 import chrome
src/adapters/   chrome.* 与 Dexie 的薄封装：events / db / config / runtime —— 只做 IO
src/shared/     defaults / datetime / format / theme.css
entrypoints/
  background.ts        SW：事件 → tracker；消息 → policy；闹钟；徽章
  gate.content.ts      页面内遮罩（闸门 / 拦截 / 倒计时）+ 频道信号 + 媒体状态
  popup/ options/ report/
```

## 2. 数据流

```
chrome 事件 ─┐
content 信号 ─┼→ adapters/events → TrackerEvent → core/tracker.step() → pieces → adapters/db（upsert）
心跳 30s ────┘                                                ↑ classify(url, channel)
content 请求判决 → SW: classify + 读 usage/passes/schedule → core/policy.decide() → Verdict → content 渲染
SW 状态变化（通行证到期 / 时段切换 / 配置变化 / 额度用完）→ 广播 'policy-changed' → content 重新请求判决
```

- **判决的唯一权威在 SW。** content 只负责渲染；popup、报告页、设置页只读写存储。
- content 每 30 秒自己轮询一次判决，作为广播丢失时的兜底。

## 3. 计时（ADR-0014）

### 3.1 对账模型

`step(state, event, deps)` 分两步：

1. **记账。** 更新窗口和标签页簿记，以及每个标签页的 `audible`、`mediaPlaying`、`channel`。有正向活动证据时，前移水位 `lastActiveAt`。
2. **对账。** 先算出"现在应该计时的目标"`desired`：

   ```
   desired = 聚焦窗口的 active tab，满足：
     url 是 http(s)
     ∧ idleState ≠ locked
     ∧ (idleState = active ∨ tab.audible ∨ tab.mediaPlaying)
   ```

   再拿 `desired` 和当前段比较：
   - 标签页、URL 或分类有任何不同 → 关闭当前段。
   - 需要计时但当前没有段 → 开新段。
   - 只有标题变化 → 原地更新，不切段。

### 3.2 关段时间（只取证据能支持的部分）

```
end = min(事件时刻, lastActiveAt + idleGrace)
若因系统 idle 关段：end = min(end, 事件时刻 − idleThreshold)   // idle 事件滞后一个阈值
end = max(end, pieceStart)
```

### 3.3 片段落库

- 每次心跳把 `[pieceStart, now − idle阈值]` 作为一个**片段**落库，再前移 `pieceStart`。落库线停在 idle 回溯点之前，因为已经落库的时长无法撤回。实时读数等于库里的数加上 `liveSeconds()`。
- **证据断档：** 任何事件到达时，如果距水位超过 `宽限 + 15s`（SW 被杀、合盖休眠），先按水位截断关段，再处理事件。这样唤醒后的 idle→active 事件就不会把空窗算进去。冷启动对账（sync）不前移水位。
- 片段带 `segId`。数据库里 `sessions` 以 `segId|date` 为键做 upsert，所以同一段只占一行，跨过逻辑日的会拆成两行。

## 4. 分类

`classify(url, channel?, override?)`，优先级为 override > 频道规则 > 网址规则 > `other`。不是 http(s) 的 URL 返回 null，即不追踪。

频道信号 `{platform: 'bilibili' | 'youtube', id, name}` 由 content 从 DOM 中提取：

- B 站视频页：UP 主链接 `space.bilibili.com/<mid>`，加上 `meta[name=author]`。
- YouTube watch 页：owner 区域的 `/@handle` 链接。

## 5. 策略（core/policy.ts）

`phaseAt(ts, schedule)` 返回 `day | winddown | curfew`。

`decide(input) → Verdict`，判决表如下：

| 时段 | 类别 | 条件 | 判决 |
|------|------|------|------|
| curfew | drift | — | block:curfew（不可延长） |
| curfew | 白名单（类别或 host） | — | allow + 横幅 late |
| curfew | 其他 | 延长有效 | allow + 横幅 ext |
| curfew | 其他 | — | block:curfew（今晚剩余次数 > 0 时可延长） |
| winddown | drift | — | block:winddown |
| winddown | 非 drift | — | allow + 横幅 winddown |
| day | drift | 通行证有效 ∧ 未封顶 | allow + 横幅 pass |
| day | drift | 封顶 | block:cap |
| day | drift | 通行证刚过期（与 `expiredPass` 同站） | block:expired（可以再申请） |
| day | drift | 无通行证 | gate（`waitSec` 按当天次数递增，时长档位不超过剩余额度） |
| day | 非 drift、非 private | — | allow |
| 收尾 / 宵禁 | private | — | 与 drift 相同：拦截且不可延长；宵禁白名单永远不放行 |
| day | private | 通行证有效 | allow + 横幅 pass |
| day | private | 通行证刚过期 | block:expired（今天还有次数时可以再来，需要重新冷静） |
| day | private | 今日次数用完 | block:private-limit |
| day | private | 其他情况 | cooldown（`waitSec` 为冷静期秒数；`checkPrivateGrant` 要求冷静期已满） |

`grantPass` 的校验也放在 core 里：必须是白天、在额度以内、档位合法、已经等够了时间。

## 6. 数据模型

**chrome.storage.local（配置）：**

```
settings  { schedule{windDown,bedtime,wake: 分钟数}, germanGoalMin, driftCapMin, passOptionsMin[],
            curfewAllow{categories[], hosts[]}, curfewExtMin, curfewExtPerNight,
            idleThresholdSec, idleGraceSec, dayCutoffHour }
rules     Rule[] { id, pattern, category, name?, createdAt }
channels  ChannelRule[] { platform, id, name, category }
targets   GermanTarget[] { id, name, url }
lastGerman { url, title, at }          // SW 在德语片段落库时更新
```

**chrome.storage.session（运行态，跨 SW 重启保留）：** `tracker` 快照、`passes {site → Pass}`、`expired {site → 时间戳}`、`curfewExt {until}`、`gateShown {tabId → 时间戳}`。

**IndexedDB（SurfWardenV3）：**

```
sessions   'id'(segId|date), date, start      明细，保留 90 天
usage      [date+category+host]               聚合秒数（永久保留）
days       'date' → { firstAt, lastAt }       每日首次和最后活动时间（作息报告用，永久保留）
events     ++id, date                         pass / curfew-ext / go-german / mark-channel 日志
```

不变量：`usage` 等于 `sessions` 之和（同一个事务里写入）。`days.lastAt` 等于当日片段的最大 end。

## 7. 权限

`tabs`、`idle`、`alarms`、`storage`、`scripting`（安装或更新时给已打开的标签页补注入 content），以及 host `<all_urls>`。去掉了 `declarativeNetRequest`。

## 8. 变更记录

- 2026-10-14 v3 初稿。
- 2026-10-14 新增私密类别与冷静期判决；配置变化后做完整对账（按新阈值重新查询 idle 状态，修复调大阈值后一直停在 idle 的问题）；视觉换成「纸与夜」（ADR-0015）。
- 2026-10-14 落库线回退一个 idle 阈值；断档检查前移到所有事件之前（修复合盖唤醒计入空窗）。白天的拦截（封顶 / 时间到）也提供频道标记，夜间不提供。类别色经 dataviz 校验换成绿 / 蓝 / 橙（避开红绿色盲冲突）。
