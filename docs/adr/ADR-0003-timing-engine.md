# ADR-0003：计时引擎采用"事件驱动段记录 + 心跳水位 + 宽限截断"

- 状态：Accepted（2026-09-06，v0.1 实现后如有修订将新增 ADR 并引用本条）
- 关联：key-algorithms.md §1、§4

## 背景

MV3 service worker 空闲 ~30s 被浏览器终止；浏览器休眠/关机时 alarms 不触发。若简单"事件累加"或"后台 setInterval 累加"，都会出现虚增（后台挂一夜 +8h）或漏计（单页久留无事件）。

## 备选方案

1. content script 内 setInterval 累加并上报：每个标签页各自计时，切页/休眠语义复杂，且 content script 生命周期同样不可靠 → 否决为主方案（可作为未来"精确视频播放检测"的补充信号）
2. 事件驱动 + 心跳水位（**采用**）：段关闭时间 = min(事件时刻, 水位+宽限)
3. 仅事件驱动无心跳：单页久留（看 40min 视频无任何 tab 事件）会被错误截断 → 否决

## 决策

- 状态机消费归一化事件（key-algorithms §1.1），段闭合规则：`end = min(at, lastActiveAt + idleGraceSec)`
- `chrome.alarms` 30s 心跳，仅在 `current !== null` 时前移水位
- 快照存 `chrome.storage.session`；`startup` 时残留段按水位截断入库
- 跨 dayCutoff 的段按天拆分（不变量 3 的要求）

## 后果

- 误差窗口 = `idleGraceSec`（默认 60s）：系统休眠时最后一段最多多计 60s，方向固定、可解释、可配置
- 代价：每个事件/心跳都要一次 `storage.session` 写入（低频，可接受）
- 单页视频久留场景由心跳兜底，但"用户实际没在看只是没锁屏"无法区分——这是 v1 已知的、接受的语义边界（与 RescueTime 同类工具一致）
